# Deployment & operations

ERP builds apps with **nixpacks**, runs as containers behind **Traefik**.

## Runtime contract

1. **Runs with standard stack start command.** Node: has `start` script in
   `package.json` (nixpacks runs `npm i` → `npm start`). Other stacks follow nixpacks conventions for that stack (Go: build binary; Python: Procfile/uvicorn…).
2. **Listens on `process.env.PORT`, binds `0.0.0.0`.** The port declared on install
   (default 3000) must match — best to just read from ENV.
3. **Relative paths.** App served under `/apps/<slug>-<id>/` via
   Traefik: frontend uses `fetch("api/me")`, **not** `/api/me`; assets don't hardcode root.
4. **Stateless with credentials.** Read everything from ENV, never write config files.

Apps can be written in any language — nixpacks auto-detects the stack. This SDK serves
TypeScript/JavaScript; other languages call the REST API directly with the same headers.

## Injected ENV

| Variable | Meaning |
| --- | --- |
| `ERP_BASE_URL` | Backend base URL (SDK auto-adds `/api/v1`) |
| `ERP_API_KEY` | Service account key — **rotates on every deploy** |
| `ERP_WORKSPACE_ID` | Workspace the app is installed in (reference; key already pins workspace) |
| `PORT` | Port app must listen on |

Plus custom variables declared during install/update (`PUT /mini-apps/:id`).

⚠️ **Never declare `ERP_ENV=development`.** It makes all record writes dry runs —
app runs without errors but saves nothing. Silent and hard to spot.

## Three sources

| Source | Install | Deploy new version |
| --- | --- | --- |
| `builtin` | `{ "source": "builtin", "templateKey": "..." }` — catalog via `GET /mini-apps/templates` | `POST /:id/deploy` |
| `repo` | `{ "source": "repo", "repoUrl": "...", "repoBranch": "main" }` | git push → `POST /:id/deploy` |
| `zip` | multipart `POST /mini-apps`, field `file` | `PUT /:id/source` multipart `file` → auto-redeploy |

Zip ≤ **25MB**, compress from project root, exclude `node_modules/` and `.git/`, **keep
`schema.json`**:

```bash
zip -r app.zip . -x "node_modules/*" -x ".git/*"
```

After install ERP **auto-deploys the first time** — no `/deploy` call needed, unless schema is pending.

## `schema.json` review screen

Backend compares declaration vs workspace at **every install and every source upload**:

```
declaration matches → schemaStatus "applied", build runs normally
declaration is missing something → schemaStatus "pending",
                         statusMessage "Waiting for a review of schema.json",
                         NO builds created
no schema.json → schemaStatus "none"
```

`POST /:id/deploy` while `pending` returns **409**. Polling builds is pointless —
no builds exist yet.

```
GET  /mini-apps/:id/schema        → { miniAppId, status, objects: [...] }
POST /mini-apps/:id/schema/apply  → MiniApp (now "applied", build queued)
```

Needs RBAC `miniapp:manage` + item-ACL manage; `sourceType: "external"` apps get 409.

`GET /schema` **recalculates diff on each call** (workspace may have changed) — open review UI fresh, **don't cache**.

`POST /schema/apply`:

- only runs when `schemaStatus === "pending"`, otherwise 409;
- only **adds** — no changes, deletes, type changes; clicking twice by accident is harmless;
- creates with **caller's permissions** → needs `object:create` and/or
  `object:field:create`, 403 if missing;
- any remaining `conflict` → 409 **before** creating anything, message names exact field and both types;
- succeeds → build queued.

App author previews before upload: `await app.schemaPlan(schema)`.

## State lifecycle

```
install / deploy ──► pending ──► building ──► running
                                   │            │ stop
                                   ▼            ▼
                                 failed      stopped ──start──► running
```

- Poll `GET /mini-apps/:id` every ~5s until `running`/`failed`. First build of a stack may take minutes (pulling base image), later ones usually <1 min.
- `failed` → `statusMessage` contains build/deploy output, read it for the error.
- `start`/`stop` **asynchronous**: response returns immediately, worker updates later.
- `deploy` during `building` → 409. `start`/`stop`/`logs` when app never successfully deployed → 409.

## Operations

```
POST   /mini-apps/:id/deploy         build + restart (rotates API key)
POST   /mini-apps/:id/start          restart stopped container
POST   /mini-apps/:id/stop           stop (not delete)
PUT    /mini-apps/:id                edit name/description/port/env/repoBranch
                                     (applies on next deploy)
GET    /mini-apps/:id/logs?tail=200  container logs (504 if worker silent 10s)
GET    /mini-apps/:id/schema         diff schema.json ⟷ workspace
POST   /mini-apps/:id/schema/apply   create missing + build
DELETE /mini-apps/:id                remove app: delete container + service account
                                     (data tables NOT deleted)
```

## Logo

Put `logo.webp` at **project root** (next to `package.json`) and serve at
`GET /logo.webp`:

```js
server.get("/logo.webp", (_req, res) =>
  res.sendFile("logo.webp", { root: process.cwd() }),
);
```

Deploy detects the file → API exposes `logoUrl`. App stopped → logo breaks, host UI falls back.

## Common errors

| Symptom | Root cause → fix |
| --- | --- |
| `failed` immediately after install, log shows `MissingPermissionsError` | Key missing declared permissions. Grant IAM rules matching `.missing` to service account, redeploy. If app declares `object:create`/`object:field:create`, **remove them** — mini apps never have them |
| Install completes, app stuck with no build | `schemaStatus: "pending"` — awaiting `schema.json` approval |
| `failed`, log shows `SchemaMismatchError` | Workspace changed after approval. `.missing`/`.conflicts` (or `schemaPlan`) shows exact gap |
| 400 uploading zip, message about field/type | `schema.json` breaks rules (unknown type, computed field, duplicate name, missing `config.targetObject`). Show message as-is |
| 403 clicking apply schema | Clicker missing `object:create`/`object:field:create` — ask admin to grant or do it themselves |
| `failed`, statusMessage is nixpacks output | Build broke: missing `start` script, lockfile stale, stack not recognized |
| Build OK but won't go `running` | Doesn't listen on correct `PORT`, or binds `localhost` instead of `0.0.0.0` |
| App up but FE calls `api/...` gets 404 | Opened app without `/` before `#` → relative fetch resolves wrong path via Traefik |
| 401 from `session()` | initData expired (5 min) or from wrong app → frontend requests fresh string |
| 401/403 mid-request after redeploy | App cached old API key; it's rotated. Only read `process.env.ERP_API_KEY` |
| 409 updating/deleting record | Version mismatch (optimistic lock) — re-read record and retry |
| 409 during install | App name slug conflicts in workspace |
| 502 with docker output | Container operation failed — read message, check worker |
| `logs` returns 504 | Worker unresponsive for 10s |
