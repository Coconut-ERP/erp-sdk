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

This package is **not published to npm**. Every release is a prebuilt tarball
attached to a [GitHub Release](https://github.com/Coconut-ERP/erp-sdk/releases) —
install it by URL with any package manager:

```bash
npm  install https://github.com/Coconut-ERP/erp-sdk/releases/download/v0.3.0/erp-sdk.tgz
bun  add     https://github.com/Coconut-ERP/erp-sdk/releases/download/v0.3.0/erp-sdk.tgz
pnpm add     https://github.com/Coconut-ERP/erp-sdk/releases/download/v0.3.0/erp-sdk.tgz
yarn add     https://github.com/Coconut-ERP/erp-sdk/releases/download/v0.3.0/erp-sdk.tgz
```

In a `package.json` dependency list that reads:

```json
{
  "dependencies": {
    "erp-sdk": "https://github.com/Coconut-ERP/erp-sdk/releases/download/v0.3.0/erp-sdk.tgz"
  }
}
```

The tarball arrives prebuilt — no compiler, no `git`, no build step on your side.
Requires Node 18+.

The asset name never carries the version, so only the tag varies — and one tag,
`latest`, is re-pointed at every release:

```bash
npm install -g https://github.com/Coconut-ERP/erp-sdk/releases/download/latest/erp-sdk.tgz
```

Use that for a global CLI install or a throwaway script. **Do not put it in an
app's `package.json`**: package managers cache and lock by URL, so a moving URL
installs whatever was cached and stops being reproducible. Dependencies get the
pinned `v0.3.0` URL above.

Installing straight from the repo also works, **but only with npm, pnpm or yarn**:

```bash
npm install github:Coconut-ERP/erp-sdk              # tracks main; builds on install
npm install ../erp-sdk                              # local path while developing
```

Those three install the repo's devDependencies and run its `prepare` script to
build `dist/`. **Bun cannot install from the repo** — it blocks lifecycle scripts,
and even when trusted it does not install a git dependency's devDependencies, so
the build fails with `tsup: command not found`. Bun users need the release tarball.

## CLI

Installing the package also installs `erp`. It is deliberately small: it sets an
environment up, proves the credentials work, and prints the real object and field
names you need before writing code. **Reading, writing and analysing records is
the SDK's job** — that work belongs in a script, not in shell flags. Results
print as JSON on stdout; notes and errors as JSON on stderr.

```bash
export ERP_BASE_URL=http://localhost:8000 ERP_API_KEY=erp_sk_...

npx erp doctor --require object:record:create   # env, connectivity, permissions
npx erp whoami                                  # who this key is, and its IAM rules
npx erp objects list                            # what tables exist
npx erp objects show "Đơn xin nghỉ"             # fields, types, config
npx erp schema dump --out workspace.json        # whole workspace as JSON
npx erp init my-app --name "Đơn xin nghỉ"       # runnable Express mini app
npx erp skill install                           # the agent skill, see below
```

Errors carry what you need to fix them — `UnknownObjectError` names the object,
`MissingPermissionsError` lists the exact `resource:action` pairs to grant.
`erp help` for the command list, `erp help <command>` for details.

## For AI agents

`erp help --json` returns the entire command surface as machine-readable JSON,
and the package ships an **`erp-data` skill** teaching agents to use this SDK
against a real workspace: reading the live schema first, querying with
filters/sorting/pagination, walking `relation` fields without N+1, aggregating
with `DataFrame`, and writing (and bulk-writing) safely.

```bash
npx erp skill install               # → .claude/skills/erp-data
npx erp skill path                  # or just point an agent at the files
```

Building a **mini app** is a different subject — that is what `docs/` covers.

See [docs/10-cli-va-ai-agent.md](docs/10-cli-va-ai-agent.md) (tiếng Việt).

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

Operators: `equals`, `not_equals`, `contains`, `in`, `not_in`, `greater_than`,
`greater_than_or_equal`, `less_than`, `less_than_or_equal`, `is_empty`,
`is_not_empty`. Max 20 filters, 3 sorts, 100 records/page (server limits).

### Matching a set of values, and fetching by id

`in`/`not_in` take a list of at most 200 values — the general form of a filter
that used to cost one request per value:

```ts
await invoices.records().whereIn("Trạng thái", ["approved", "paid"]).fetchAll();
await invoices.records().whereNotIn("Trạng thái", ["draft"]).fetchAll();
```

The filter target `"id"` is the record's own id rather than a field, and it
takes `equals`, `not_equals`, `in` and `not_in` only. It pairs with relations: a
relation field arrives inside `data` as an array of related record ids, no
`preload` needed, so a list screen reads the ids and then fetches them in one
request instead of one per row.

```ts
const lines = await invoiceLines.records().fetchAll();
const customerIds = lines.flatMap((line) => (line.data.customer as string[]) ?? []);

const customers = await customersTable.getMany(customerIds); // chunks by 200, keeps order
// or, one page at a time:
await customersTable.records().whereIds(customerIds.slice(0, 200)).fetch();
```

`getMany` de-duplicates the ids and returns records in the order asked for; an
id the caller's row scopes exclude is simply absent, so a shorter result is
normal. A query filtered by id skips its COUNT unless you ask for
`withTotal()` — the number is one the caller already sent in.

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

### Writing many records at once

Three calls exist so an app that touches thousands of rows does not turn each
one into its own HTTP request and its own database transaction.

```ts
// Bulk insert — one request, one transaction, all-or-nothing.
const { created } = await invoices.createMany([
  { "Số hóa đơn": "INV-001", "Tổng tiền": 500_000 },
  { "Số hóa đơn": "INV-002", "Tổng tiền": 750_000 },
]);

// Bulk update by query — one UPDATE over every matching row. null clears a field.
const result = await invoices
  .records()
  .where("Trạng thái", "equals", "draft")
  .where("Hạn thanh toán", "less_than", "2026-01-01")
  .update({ "Trạng thái": "overdue", "Ghi chú": null });
// { matched, updated, hasMore }
```

An invalid row rejects the whole insert naming its index, so a half-imported
table never happens; batches over 500 records are split for you. A bulk update
is capped server-side (5 000 rows per call) and sets `hasMore` when the filters
matched more than that — repeat the same call until it is false. Two rules to
know: a **unique** field cannot be *set* by a bulk update (one value across many
rows collides with itself) though it can be cleared, and computed fields
(`formula`/`lookup`/`rollup`) are left stale for the worker to recompute rather
than evaluated inside the write.

### Preloading relations (the 1-n problem)

A relation lives in the link table, not in a record's `data`, so showing a list
with its related records used to mean one `listLinks` call per row. `preload`
resolves them for the whole page in a fixed number of queries instead.

```ts
const invoices = await app.object("Hóa đơn bán hàng");
const lines = await app.object("Chi tiết hóa đơn");

// 1-n: the relation field lives on the child, so pass its FieldDto.
const page = await invoices.records().preload(lines.field("Hóa đơn")).fetch();
for (const invoice of page.records) {
  const children = invoices.related(invoice, lines.field("Hóa đơn"));
}

// n-1: the field is on this object, so its name is enough.
const withParent = await lines.records().preload("Hóa đơn").fetch();
```

The direction is inferred from which object owns the field, so one query can
fan out both ways at once — an invoice carrying its customer *and* its lines is
two `preload` calls on one request:

```ts
const page = await orders
  .records()
  .preload("Customer")                 // n-1, up
  .preload(items.field("Order"))       // 1-n, down
  .fetch();
```

Preloading is one level deep: a preloaded record carries no `related` of its
own, so users → orders → items (anchored on users) is two round trips. Related
records are read under the caller's own row scopes, so preloading never
surfaces a record the caller could not have fetched by id. Up to 10 relations
per query and 50 related records per row by default (`{ limit }`, max 100).

### Declaring the tables an app needs: `schema.json`

A mini app **cannot create objects or fields** — its service account is a
`member`. It declares what it needs in a `schema.json` at the root of its
source; whoever deploys the app reviews the declaration against the workspace
and applies it under *their* permissions, before the first build runs.

```json
{
  "objects": [
    {
      "name": "Đơn nghỉ phép",
      "fields": [
        { "name": "Lý do", "type": "long_text" },
        { "name": "Số ngày", "type": "number", "config": { "precision": 1 } },
        { "name": "Nhân viên", "type": "relation", "config": { "targetObject": "Nhân viên" } }
      ]
    }
  ]
}
```

Each entry is the body of `POST /objects` / `POST /objects/:id/fields`, plus
`fields`. Relations name their target by **display name** — an app never sees
object ids. `formula`, `lookup` and `rollup` cannot be declared (their config
addresses other fields by internal key); create those by hand.

At boot the app only checks:

```ts
const schema = JSON.parse(readFileSync(new URL("./schema.json", import.meta.url), "utf8"));

// Matches → a handle per declared object. Doesn't → SchemaMismatchError naming
// what is missing, and pointing at the deploy-time review.
const { "Đơn nghỉ phép": leaves } = await app.assertSchema(schema);
```

Catch a bad declaration before uploading the zip — same rules the backend
applies, plus the diff the review screen shows. These are pure functions, so a
CI check needs no credentials:

```ts
import { validateSchema, planSchema, schemaConflicts } from "erp-sdk";

validateSchema(schema);            // string[] of everything the backend would reject
schemaConflicts(planSchema(schema, workspace));   // workspace = `erp schema dump`.objects
await client.schemaPlan(schema);   // or let a client fetch the workspace shape for you
```

`validateSchema`, `planSchema`, `schemaConflicts` and friends are also exported
for build scripts that generate the file from TypeScript definitions.

### Shaping a workspace with an admin key

`createObject` / `ensureObject` / `addField` still exist for tooling run with an
admin key — preparing a demo workspace, for instance. Called from a mini app at
boot they only return 403, which is what `assertSchema` exists to prevent.

```ts
const orders = await admin.ensureObject("Đơn đặt hàng", [{ name: "Số lượng", type: "number" }]);
await orders.updateField("Số lượng", { name: "SL" });
await orders.rename("Đơn hàng");
await admin.deleteObject("Đơn hàng");
```

A complete runnable app built on this flow lives in
`examples/miniapp-leave-request` (Express + form UI + initData bridge).

## Worked example: leave-request mini app

The full lifecycle of an embedded mini app — declare permissions, check the
tables it declared, and create records on behalf of the interacting user:

```ts
import { readFileSync } from "node:fs";
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
    { resource: "object:field", action: "read" },
    { resource: "object:record", action: "create" },
    { resource: "object:record", action: "read" },
  ],
});

// 2. Check the tables declared in schema.json — the deployer already reviewed
//    and applied them, so a mismatch here means the workspace drifted.
const schema = JSON.parse(readFileSync(new URL("./schema.json", import.meta.url), "utf8"));
const { "Đơn xin nghỉ": leaves } = await app.assertSchema(schema);

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
| `SchemaMismatchError` | `assertSchema` found the workspace missing (or retyping) something `schema.json` declares (`.missing`, `.conflicts`) |
| `UnknownObjectError` | `app.object(name)` doesn't match any object in the workspace |
| `UnknownFieldError` | a filter/sort/data key doesn't match any field (`.known` lists fields) |

## Issuing a key for a mini app

In the ERP, create a service account and key (`POST
/iam/service-accounts/:id/api-keys`), then attach IAM rules granting exactly
the permissions the app declares. The key's workspace membership defines its
tenant; row scopes on `object:record` further narrow what it can read.

Installing through the Mini App module does this for you: the app's service
account joins the workspace as `member` (or `viewer`) — never `admin`, since
schema changes go through the `schema.json` review instead.

## Development

```bash
npm install
npm test          # vitest
npm run typecheck
npm run build     # tsup → dist/ (ESM + CJS + d.ts)
```
