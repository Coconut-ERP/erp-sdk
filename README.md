# erp-sdk

TypeScript SDK for the ERP backend. Built for **mini apps**: each customer
deployment ships one or more small TypeScript apps that use this backend as
their core engine, authenticated with a service-account API key.

Requires Node 18+ (uses global `fetch`). Works in the browser too, but API keys
belong on a server — don't ship `erp_sk_*` keys to browsers.

> **📚 Tài liệu đầy đủ (tiếng Việt): [docs/README.md](docs/README.md)** — từ
> số 0 đến một mini app chạy thật: kiến trúc, quick start, dữ liệu, initData,
> phân quyền, triển khai, API reference và tutorial từng bước.

## Install

```bash
npm install erp-sdk        # or: npm install ../erp-sdk (local path while unpublished)
```

## Quick start

When the app is installed through the ERP's **Mini App module**
(`POST /mini-apps`), the platform builds it with nixpacks and injects
`ERP_BASE_URL`, `ERP_API_KEY` (rotated on every deploy), `ERP_WORKSPACE_ID`,
and `PORT` into the container — so bootstrapping is just:

```ts
import { createMiniApp } from "erp-sdk";

const app = await createMiniApp({
  baseUrl: process.env.ERP_BASE_URL!,
  apiKey: process.env.ERP_API_KEY!, // erp_sk_... issued from IAM service accounts
  permissions: [
    { resource: "object", action: "read" },
    { resource: "object:field", action: "read" },
    { resource: "object:record", action: "read" },
    { resource: "object:record", action: "create" },
  ],
});
```

`createMiniApp` verifies the key against `/iam/me/permissions` on startup. If
the key is missing anything the app declared, it throws
`MissingPermissionsError` listing exactly what to grant — so a misconfigured
deployment fails at boot, not in the middle of a user flow.

The API key pins its own workspace on the backend, so you never pass
`X-Workspace-Id`. For user-context apps you can pass `accessToken` (JWT) +
`workspaceId` instead of `apiKey`.

## Working with objects

Objects and fields are addressed by **display name or key** — the SDK loads the
schema once and resolves names for you (`"Trạng thái"` → `status`). Unknown
names throw `UnknownFieldError` with the list of known fields.

```ts
const invoices = await app.object("Hóa đơn bán hàng"); // by name or id

// Server-side filter / sort / pagination (POST /records/query)
const page = await invoices
  .records()
  .where("Trạng thái", "equals", "approved")
  .where("Tổng tiền", "greater_than", 1_000_000)
  .orderBy("Tổng tiền", "desc")
  .limit(50)
  .withTotal()
  .fetch(); // { records, nextCursor, hasMore, total }

const all = await invoices.records().where("Trạng thái", "equals", "approved").fetchAll(); // auto-paginates
const one = await invoices.records().where("Số hóa đơn", "equals", "INV-001").first();
const n   = await invoices.records().count();
```

Operators: `equals`, `not_equals`, `contains`, `greater_than`,
`greater_than_or_equal`, `less_than`, `less_than_or_equal`, `is_empty`,
`is_not_empty`. Max 20 filters, 3 sorts, 100 records/page (server limits).

### CRUD

```ts
const created = await invoices.create({ "Trạng thái": "draft", "Tổng tiền": 500_000 });

await invoices.update(created.id, { "Trạng thái": "approved" }); // fetches current version
await invoices.update(created.id, { "Trạng thái": "approved" }, created.version); // explicit optimistic lock

await invoices.delete(created.id);            // soft delete
await invoices.restore(created.id, version);  // undo

await invoices.createLink(recordId, "Khách hàng", customerRecordId);
await invoices.listLinks(recordId, "Khách hàng");
await invoices.deleteLink(recordId, "Khách hàng", customerRecordId);
```

### Schema management

Mini apps can also provision their own schema (requires `object` /
`object:field` create/update/delete permissions):

```ts
const orders = await app.createObject("Đơn đặt hàng");
await orders.addField("Số lượng", "number");
await orders.addField("Khách hàng", "text");
await orders.create({ "Số lượng": 3, "Khách hàng": "An" }); // new fields usable immediately

await orders.updateField("Số lượng", { name: "SL" });
await orders.rename("Đơn hàng");
await app.deleteObject("Đơn hàng");
```

A complete runnable app built on this flow lives in
`examples/miniapp-leave-request` (Express + form UI + initData bridge).

## Worked example: leave-request mini app

The full lifecycle of an embedded mini app — declare permissions, provision its
table on first run, and create records on behalf of the interacting user:

```ts
import {
  createMiniApp,
  parseInitData,
  readInitDataFromLocation,
  receiveInitData,
  sendInitDataToFrame,
} from "erp-sdk";

// 1. Boot: fails fast with MissingPermissionsError if the key can't do this
const app = await createMiniApp({
  baseUrl: process.env.ERP_BASE_URL!,
  apiKey: process.env.ERP_API_KEY!,
  permissions: [
    { resource: "object", action: "read" },
    { resource: "object", action: "create" },
    { resource: "object:field", action: "read" },
    { resource: "object:field", action: "create" },
    { resource: "object:record", action: "create" },
    { resource: "object:record", action: "read" },
  ],
});

// 2. First run: create the table if it doesn't exist yet (idempotent)
const leaves = await app.ensureObject("Đơn xin nghỉ", [
  { name: "Người xin nghỉ", type: "single_select", config: { source: "workspace_users" } },
  { name: "Lý do", type: "long_text" },
  { name: "Từ ngày", type: "date" },
  { name: "Đến ngày", type: "date" },
  { name: "Trạng thái", type: "single_select", config: {
    source: "static", options: ["pending", "approved", "rejected"],
  } },
]);

// 3. Per launch: know who is interacting — Telegram-style initData.
//    The host never shares its own token with the mini app.

//    3a. Host app (main app frontend/backend, acting as the logged-in user):
const { initData } = await hostClient.issueInitData(miniAppServiceAccountId);
sendInitDataToFrame(iframe.contentWindow!, initData, "https://miniapp.example.com");
//    ...or embed it in the mini app URL: `https://miniapp.example.com/#erpInitData=<encoded>`

//    3b. Mini app frontend picks it up:
const initData =
  readInitDataFromLocation() ??
  (await receiveInitData({ allowedOrigins: ["https://erp-main-app.example.com"] }));
const preview = parseInitData(initData); // UNVERIFIED — display only (e.g. "Xin chào An")

//    3c. Mini app server verifies it and acts with the APP's authority:
const { user } = await app.session(initData); // verified identity only
await leaves.create({
  "Người xin nghỉ": user.id, // identity recorded in the data
  "Lý do": "Việc gia đình",
  "Từ ngày": "2026-08-03",
  "Đến ngày": "2026-08-05",
  "Trạng thái": "pending",
}); // runs under the app's service account — works even if the user's own
//    role could not write this object
```

### Whose permissions apply? Two authority modes

**App authority (default — recommended, Telegram-bot style).** Anyone allowed
to *use* the app (mini app ACL) gets the app's full functionality: data
operations run on the service-account client (`app`), and `session(initData)`
is used only to know verifiably *who* is acting. Record the user id in a
field. The user needs no permissions on the underlying objects — the ERP
checked they may use the app, and the app defines what using it means.
Per-user data boundaries (e.g. "only my requests") are the app's job to
enforce in its queries.

**User authority (opt-in).** Use `session(initData).client` (or `asUser`) so
every call is limited by that user's own IAM permissions and row scopes —
`createdBy` is the real user. Pick this only when the app must mirror the
ERP's per-user data access (e.g. a generic data browser); a user without the
underlying object permissions will get 403s inside the app.

### How initData works (Telegram Mini App model)

- The host asks the backend (`POST /auth/miniapp/init-data`) for a signed
  string identifying *the current user*, *the workspace*, and *the target mini
  app* (its service account id), with an `auth_date` timestamp. The signature
  is HMAC-SHA256 keyed from the server's auth secret — same construction
  Telegram uses for Web App `initData`.
- initData is safe to pass through URLs or postMessage: it grants nothing by
  itself and can only be redeemed by the one mini app it names, because the
  exchange endpoint (`POST /auth/miniapp/session`) requires that mini app's
  API key. Stolen initData is useless without the key; a different mini app's
  key is rejected ("issued for a different mini app").
- initData expires after 5 minutes and the exchanged access token after the
  normal access TTL (~15 min). There is no refresh token: when the session
  expires, the mini app asks its host for fresh initData — exactly the
  re-launch model Telegram uses.
- The backend re-checks at exchange time that the user is still an active
  member of the workspace, so a removed user's stale initData is dead.
- `parseInitData` on the client is for greeting text only; nothing client-side
  is trusted. Verification lives server-side in the exchange.

Field types: `text`, `long_text`, `number`, `currency`, `percent`, `checkbox`,
`date`, `datetime`, `single_select`, `multi_select`, `url`, `email`, `phone`,
`relation`, `lookup`, `rollup`, `formula`, `attachment`.

## DataFrame — pandas-style analysis

`toFrame()` pulls all matching records and wraps them in an immutable,
lodash-backed `DataFrame`. Columns are field **display names** (plus `id`,
`version`, `createdAt`, `updatedAt`); computed fields are included. Use
`toFrame({ by: "key" })` for field keys instead.

```ts
const df = await invoices.records().where("Trạng thái", "equals", "approved").toFrame();

df.count();
df.sum("Tổng tiền");
df.avg("Tổng tiền");
df.where("Tổng tiền", "greater_than", 1_000_000).head(10).toArray();
df.sortBy("Tổng tiền", "desc").select("Khách hàng", "Tổng tiền").toArray();

// Group + aggregate
df.groupBy("Khách hàng")
  .agg({ revenue: ["sum", "Tổng tiền"], orders: ["count"] })
  .sortBy("revenue", "desc")
  .head(5)
  .toArray();
// [{ "Khách hàng": "An", revenue: 300, orders: 2 }, ...]

// Join two objects
const customers = await (await app.object("Khách hàng")).records().toFrame();
df.leftJoin(customers, "Khách hàng", "Tên", { prefix: "kh_" });
```

Full surface: `filter`, `where`, `map`, `select`, `rename`, `sortBy`, `unique`,
`uniqueBy`, `pluck`, `head`, `tail`, `slice`, `first`, `last`, `at`, `sum`,
`avg`, `min`, `max`, `countBy`, `keyBy`, `groupBy().agg()/count()/sum()/avg()`,
`leftJoin`. Every method returns a new frame — chains never mutate.

## Permissions at runtime

```ts
await app.can("object:record", "delete");           // boolean, cached
await app.assertPermissions([{ resource: "workflow", action: "read" }]); // throws if missing
const granted = await app.myPermissions();          // raw effective permissions
```

Checks mirror the backend enforcer exactly: deny beats allow, `*` matches any
resource/action, and `manage` does **not** imply other actions. Note that even
with the RBAC gate passed, `object:record` reads are still narrowed by IAM row
scopes and restricted items stay hidden — server-side enforcement is always the
source of truth; the SDK check is a fast preflight.

## Errors

| Error | When |
| --- | --- |
| `MissingPermissionsError` | declared permissions not granted to the key (`.missing` lists them) |
| `ErpApiError` | any non-2xx response (`.status`, `.trace`, `.details`) |
| `UnknownObjectError` | `app.object(name)` doesn't match any object in the workspace |
| `UnknownFieldError` | a filter/sort/data key doesn't match any field (`.known` lists fields) |

## Issuing a key for a mini app

In the ERP, create a service account and key (`POST
/iam/service-accounts/:id/api-keys`), then attach IAM rules granting exactly
the permissions the app declares. The key's workspace membership defines its
tenant; row scopes on `object:record` further narrow what it can read.

## Development

```bash
npm install
npm test          # vitest
npm run typecheck
npm run build     # tsup → dist/ (ESM + CJS + d.ts)
```
