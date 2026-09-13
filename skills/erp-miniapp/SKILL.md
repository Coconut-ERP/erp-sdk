---
name: erp-miniapp
description: Builds mini apps on Coconut ERP with erp-sdk — small web apps that use the ERP as their database, access control and identity, opened inside the ERP. Covers `erp init`, declaring tables in schema.json and checking them with `assertSchema`, Telegram-style signed initData and `session()`, service-account permissions, and the deploy contract (nixpacks, PORT, relative URLs, schema review). Use when the user wants an app on the ERP ("a leave request app", "a data entry form for staff", "a dashboard app for managers", "a web app without its own database") or mentions mini apps, schema.json, initData or deploying to the ERP. Scripts that only read or write existing data are erp-data.
---

# Mini apps on the ERP

A mini app is a small web app installed per workspace and opened in an iframe inside
the ERP, which supplies its data, access control and user identity — the Telegram
Mini App model. The **server** half is required: it holds the API key and calls the
ERP through the SDK. The **frontend** half is optional and never sees the key.

Three constraints shape every design:

1. **The app cannot create tables.** Its service account is a `writer` — full on
   records, files and dashboards, read-only on objects and fields. It declares the
   tables it needs in `schema.json`, and the deployer reviews and creates them. → §2
2. **The app never receives a user JWT.** It receives signed `initData` and trades it
   for a verified identity with `session()`. → §3
3. **The API key rotates on every deploy.** Read `process.env.ERP_API_KEY`; never
   hard-code it or keep it anywhere else. → §4

## 1. Start from the scaffold

```bash
npx erp init leave-request --name "Leave Request" --object "Leave Request"
```

It writes `server.js` (Express with the initData bridge), `schema.json`,
`public/index.html`, `.env.example` and `README.md`, and runs as is — iterate on it
rather than starting from nothing.

Boot in this order:

```ts
import { readFileSync } from "node:fs";
import { createMiniApp } from "erp-sdk";

const schema = JSON.parse(readFileSync(new URL("./schema.json", import.meta.url), "utf8"));

const app = await createMiniApp({
  baseUrl: process.env.ERP_BASE_URL,
  apiKey: process.env.ERP_API_KEY,
  permissions: [                                  // a missing permission fails at boot
    { resource: "object", action: "read" },
    { resource: "object:field", action: "read" },
    { resource: "object:record", action: "read" },
    { resource: "object:record", action: "create" },
  ],
});

const { "Leave Request": leaves } = await app.assertSchema(schema);   // one clear error on mismatch
```

Declare only the permissions the app uses. Never declare `*`, `object:create` or
`object:field:create`: a service account never holds them, so the app would die at
boot with `MissingPermissionsError`.

## 2. Declare tables in `schema.json`

At the project root. Each object is the body of `POST /objects` plus its `fields`:

```json
{
  "objects": [
    {
      "name": "Leave Request",
      "fields": [
        { "name": "Requester", "type": "single_select", "config": { "source": "workspace_users" } },
        { "name": "Reason", "type": "long_text" },
        { "name": "Status", "type": "single_select",
          "config": { "source": "static", "options": ["pending", "approved"] } }
      ]
    }
  ]
}
```

Check it before uploading:

```js
import { validateSchema } from "erp-sdk";
validateSchema(schema);          // string[] of backend errors, no credentials needed; [] = valid
await app.schemaPlan(schema);    // diff against the live workspace, never throws
```

`formula` / `lookup` / `rollup` cannot be declared; a `relation` names its target in
`config.targetObject` by table name; and a schema can only add — retyping an existing
field is a `conflict` someone fixes by hand. Format, types and rules:
`references/schema.md`.

## 3. Know who is using the app

Every frontend request carries `X-Init-Data`; the server turns it into a verified
user with `app.session(initData)` → `{ user, client, expiresIn }`, cached per string.
initData lives **5 minutes** with no refresh token, so a 401 is routine and the
frontend asks the host for a fresh string. `parseInitData()` in the browser is
unverified and for display only. Middleware, frontend code and caching:
`references/identity.md`.

Pick one authority model early:

| | App authority (default) | User authority (opt-in) |
| --- | --- | --- |
| Calls run as | the app's service account | `session(initData).client` / `asUser(token)` |
| `createdBy` | the service account | the real user |
| Who can do what | everyone who opens the app gets every feature | the user's own IAM and row scope |
| Keeping users' data apart | **the app's job**, with `where` | the server's |

Under app authority every per-user query filters on the **verified** id from
`session()`, never on an id the frontend sent:

```ts
const { user } = req.erp;
await leaves.create({ Requester: user.id, Reason: req.body.reason });
const mine = await leaves.records()
  .where("Requester", "equals", user.id)   // leaving this out leaks other users' data
  .fetchAll();
```

## 4. Deploy contract

The ERP builds with nixpacks and runs the container behind Traefik. The app must:

- have a start command (Node: a `start` script);
- **listen on `process.env.PORT` and bind `0.0.0.0`**, not `localhost`;
- **use relative URLs** in the frontend (`fetch("api/me")`, not `/api/me`), because it
  is served under `/apps/<slug>-<id>/`;
- read every credential from the environment, where the ERP injects `ERP_BASE_URL`,
  `ERP_API_KEY`, `ERP_WORKSPACE_ID` and `PORT`.

**Never set `ERP_ENV=development` on an installed app**: every record write becomes a
dry run, and the app looks healthy while saving nothing.

After install the ERP deploys on its own — unless `schema.json` needs review. Then the
app waits at `schemaStatus: "pending"` with **no build** until the deployer approves;
that is not a build failure. Sources, lifecycle and the error table:
`references/deploy.md`.

Changing the deployer's workspace structure with an admin key is not the app's job —
ask first.

## References

- `references/schema.md` — `schema.json` format, field types, backend rules,
  `validateSchema` / `planSchema` / `assertSchema`, evolving a schema.
- `references/identity.md` — the initData flow, frontend and server code, the two
  authority models, a security checklist.
- `references/deploy.md` — runtime contract, install sources, schema review, status
  lifecycle, operations, common errors.
- Skill `erp-data` — queries, relations, `DataFrame`, SQL.
- Skill `erp-tools` — workflows, the drive, and the task board (reached through
  `session(initData).client`, never the app's own key).
