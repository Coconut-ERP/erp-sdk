---
name: erp-miniapp
description: Build mini apps running on Coconut ERP using erp-sdk — web apps using ERP as an engine instead of a separate database. Use when the task mentions mini app / miniapp ERP, erp init, schema.json, assertSchema, initData / X-Init-Data / session(), createMiniApp + permissions, service account erp_sk_, deploying apps to ERP (zip/repo/template), schema review on deploy, or when the user wants to "build an X management app on ERP", "leave request app", "time tracking app", "build data entry form for staff", "dashboard app for managers", "create web app without a database". For only reading/writing/analyzing data on an existing workspace (scripts, reports, imports) use the erp-data skill.
---

# Building mini apps on ERP

A mini app is a **small web app installed per workspace**, opened inside ERP's
UI (iframe) and uses ERP as its engine: data, access control, and user identity all
come from ERP instead of being built separately. Like a Telegram Mini App.

Two halves: **server** (required — holds API key, calls ERP via SDK, serves frontend) and
**frontend** (optional per app — runs in iframe, receives initData, calls back to app's server). API keys **stay on server only**, never go to the browser.

## Three core constraints that shape all design

Read these three lines carefully before writing any code — they are the source of most mistakes:

1. **Apps cannot create tables.** The app's service account is a `writer` — full
   access to records, files and dashboards, read-only on `object`/`object:field` — so
   calling `POST /objects` gets 403. Apps **declare** tables they need in `schema.json`;
   the deployer reviews and creates them with *their* permissions. → §2
2. **Apps don't receive user JWTs.** They receive signed `initData` and trade it for
   verified identity via `session()`. → §3
3. **API keys rotate on every deploy.** Always read `process.env.ERP_API_KEY`,
   never hardcode, never cache outside env. → §4

## 1. Bootstrap an app

```bash
npx erp init leave-request --name "Leave Request" --object "Leave Request"
```

Generates `server.js` (Express + initData bridge), `schema.json`, `public/index.html`,
`.env.example`, `README.md`. Runs immediately — iterate from there instead of from scratch.

Standard bootstrap, **this order is mandatory**:

```ts
import { readFileSync } from "node:fs";
import { createMiniApp } from "erp-sdk";

const schema = JSON.parse(
  readFileSync(new URL("./schema.json", import.meta.url), "utf8"),
);

// 1. Connect + preflight permissions: missing permissions fails at boot,
//    not mid-request.
const app = await createMiniApp({
  baseUrl: process.env.ERP_BASE_URL,
  apiKey: process.env.ERP_API_KEY,
  permissions: [
    { resource: "object", action: "read" },
    { resource: "object:field", action: "read" },
    { resource: "object:record", action: "read" },
    { resource: "object:record", action: "create" },
  ],
});

// 2. Fail fast if workspace doesn't match schema.json — one clear error,
//    not UnknownFieldError scattered through every route.
const { "Leave Request": leaves } = await app.assertSchema(schema);
```

Declare only the permissions your app uses, **never declare `*`**, and **never declare `object:create` /
`object:field:create`** — service accounts never have them, declaring them kills the app at boot with `MissingPermissionsError`.

## 2. `schema.json` — declare, don't create

File at **project root**. Each object = body of `POST /objects` plus `fields`:

```json
{
  "objects": [
    {
      "name": "Leave Request",
      "fields": [
        { "name": "Requester", "type": "single_select",
          "config": { "source": "workspace_users" } },
        { "name": "Reason", "type": "long_text" },
        { "name": "Status", "type": "single_select",
          "config": { "source": "static", "options": ["pending", "approved"] } }
      ]
    }
  ]
}
```

Validate **before** uploading — pure functions, no credentials needed:

```js
import { validateSchema } from "erp-sdk";
validateSchema(schema);            // string[] of backend errors; [] = valid
await app.schemaPlan(schema);      // diff with real workspace, doesn't throw
```

Common mistakes: `formula`/`lookup`/`rollup` **can't be declared**;
`relation` needs `config.targetObject` as **table name**; only **adding** is allowed,
changing field types on existing fields is a `conflict` requiring manual fixes. Full details + all 18 field types:
`references/schema.md`.

## 3. Know who's using the app

```ts
server.use("/api", async (req, res, next) => {
  const initData = req.header("x-init-data");
  if (!initData) return res.status(401).json({ error: "Missing X-Init-Data" });
  try {
    req.erp = await identify(initData);   // cache by initData string
    next();
  } catch (e) {
    res.status(401).json({ error: e.message });   // FE re-requests fresh initData
  }
});
```

initData lives **5 minutes**, no refresh token — 401 is normal,
frontend must handle it. Frontend reads the string via `readInitDataFromLocation()` or
`receiveInitData()`; `parseInitData()` is **unverified**, display-only ("Hello Alice"). Full flow + frontend code: `references/identity.md`.

**Two permission models — choose early, don't mix:**

| | App authority (default) | User authority (opt-in) |
| --- | --- | --- |
| Runs as | app's client (service account) | `session(initData).client` / `asUser(token)` |
| `createdBy` | service account | real user |
| Permissions | anyone who can open the app uses full features | true RBAC + row scope of that user |
| Data boundaries between users | **app's responsibility** via `where` | server handles automatically |

App authority is the default recommendation (like a Telegram bot). Trade-off: every query by user **must** `where` by a verified user id from `session()` — never trust id from frontend:

```ts
const { user } = req.erp;
await leaves.create({ "Requester": user.id, "Reason": req.body.reason });
const mine = await leaves.records()
  .where("Requester", "equals", user.id)   // forgetting this = data leak
  .fetchAll();
```

## 4. Runtime contract on deploy

ERP builds with nixpacks, runs as container behind Traefik. Valid apps:

- have a `start` script (Node: nixpacks runs `npm i` → `npm start`);
- **listen on `process.env.PORT`, bind `0.0.0.0`** — not `localhost`;
- **use relative URLs** on frontend (`fetch("api/me")`, not `/api/me`) — app is served under `/apps/<slug>-<id>/`;
- read all credentials from ENV, never write config files.

ERP injects `ERP_BASE_URL`, `ERP_API_KEY`, `ERP_WORKSPACE_ID`, `PORT`.

⚠️ **Never declare `ERP_ENV=development` for installed apps.** It turns all record writes to dry runs: app runs without errors but nothing saves — hardest kind of silent failure. Omit it.

After install ERP auto-deploys, **unless** `schema.json` doesn't match: app stalls at `schemaStatus: "pending"` and **no builds created** until the deployer approves. Full lifecycle, three sources (template/repo/zip), error table: `references/deploy.md`.

## Pitfalls learned the hard way

- **App stalled after install, no build** → `schemaStatus: "pending"`, awaiting `schema.json` review. Not a build failure.
- **`MissingPermissionsError` at boot** → key missing declared permissions, or app declared `object:create` (mini apps never have it). Read `.missing`.
- **FE calls `api/...` gets 404** → app host opened without `/` before `#`, relative fetch resolves wrong through Traefik.
- **401/403 after redeploy** → app cached old API key; it's rotated.
- **Build OK but won't go `running`** → binds `localhost` instead of `0.0.0.0`,
  or doesn't listen on `PORT`.
- **`relation` fields write is replace-entire-list**, not append — `[]` clears links,
  `null` keeps them. See erp-data skill.
- **Reading 0 records despite data existing** → row scope IAM, not a filter bug.

Before modifying the deployer's workspace structure (creating tables, changing fields via admin key): **ask**. That's not the app's job.

## References

- `references/schema.md` — `schema.json`: format, 18 field types, backend rules,
  `validateSchema`/`planSchema`/`assertSchema`, evolving schema later.
- `references/identity.md` — complete initData: signature flow, frontend + server code, session caching,
  two permission models, security checklist.
- `references/deploy.md` — runtime contract, three sources, schema review UI,
  state lifecycle, ENV, logo, common error table.
- Reading/writing/analyzing data (queries, DataFrame, SQL, workflows) → skill **`erp-data`**.
