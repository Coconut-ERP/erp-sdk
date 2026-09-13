# Deploying and operating a mini app

## Contents

- [Runtime contract](#runtime-contract)
- [Install sources](#install-sources)
- [Schema review](#schema-review)
- [Status lifecycle](#status-lifecycle)
- [Operations](#operations)
- [Logo](#logo)
- [Common errors](#common-errors)

## Runtime contract

1. **A standard start command.** Node: a `start` script (nixpacks runs `npm i`, then
   `npm start`). Other stacks follow nixpacks conventions and call the REST API with
   the same headers the SDK sends.
2. **Listen on `process.env.PORT`, bind `0.0.0.0`.**
3. **Relative paths.** The app is served under `/apps/<slug>-<id>/`: `fetch("api/me")`,
   not `/api/me`, and no root-relative assets.
4. **Credentials from the environment only**, never written to config files.

| Injected | Meaning |
| --- | --- |
| `ERP_BASE_URL` | Backend URL (the SDK adds `/api/v1`) |
| `ERP_API_KEY` | Service-account key — **rotates on every deploy** |
| `ERP_WORKSPACE_ID` | The install's workspace (the key already pins it) |
| `PORT` | The port to listen on |

Custom variables are set at install or with `PUT /mini-apps/:id`. Never set
`ERP_ENV=development` there: every record write would silently become a dry run.

## Install sources

| Source | Install | New version |
| --- | --- | --- |
| `builtin` | `{ "source": "builtin", "templateKey": "…" }` — catalog at `GET /mini-apps/templates` | `POST /:id/deploy` |
| `repo` | `{ "source": "repo", "repoUrl": "…", "repoBranch": "main" }` | push, then `POST /:id/deploy` |
| `zip` | multipart `POST /mini-apps`, field `file` | multipart `PUT /:id/source`, field `file` — redeploys |

A zip is ≤ 25 MB, built from the project root without `node_modules/` or `.git/`, and
keeps `schema.json`:

```bash
zip -r app.zip . -x "node_modules/*" -x ".git/*"
```

The first deploy after install is automatic unless the schema is pending.

## Schema review

Every install and every source upload compares `schema.json` with the workspace:

| Result | `schemaStatus` | Build |
| --- | --- | --- |
| Everything exists | `applied` | Runs |
| Something is missing | `pending`, message "Waiting for a review of schema.json" | **None** — `POST /:id/deploy` answers 409 |
| No `schema.json` | `none` | Runs |

```
GET  /mini-apps/:id/schema        → { miniAppId, status, objects: [...] }   recomputed on every call; don't cache
POST /mini-apps/:id/schema/apply  → MiniApp, now "applied", build queued
```

Both need `miniapp:manage` plus manage on the app; an `external` app answers 409.
`apply`:

- runs only while `pending` (else 409), and clicking twice is harmless;
- only adds — no renames, deletes or retyping;
- creates under the **caller's** permissions, so it needs `object:create` and/or
  `object:field:create` (403 otherwise);
- refuses with 409 before creating anything if a `conflict` remains, naming the field
  and both types.

The author previews the same diff with `await app.schemaPlan(schema)`.

## Status lifecycle

```
install / deploy ──► pending ──► building ──► running
                                   │            │ stop
                                   ▼            ▼
                                 failed      stopped ──start──► running
```

- Poll `GET /mini-apps/:id` about every 5 s until `running` or `failed`. A stack's
  first build can take minutes; later ones are usually under one.
- On `failed`, `statusMessage` holds the build or deploy output.
- `start` / `stop` return immediately and take effect later.
- `deploy` while `building` → 409; `start` / `stop` / `logs` on an app that never
  deployed → 409.

## Operations

```
POST   /mini-apps/:id/deploy         build and restart (rotates the API key)
POST   /mini-apps/:id/start          start a stopped container
POST   /mini-apps/:id/stop           stop without deleting
PUT    /mini-apps/:id                name, description, port, env, repoBranch — applied on the next deploy
GET    /mini-apps/:id/logs?tail=200  container logs (504 if the worker is silent for 10 s)
DELETE /mini-apps/:id                remove the container and service account; data tables stay
```

## Logo

Put `logo.webp` at the project root and serve it at `GET /logo.webp`:

```js
server.get("/logo.webp", (_req, res) => res.sendFile("logo.webp", { root: process.cwd() }));
```

The deploy detects it and the API exposes `logoUrl`. While the app is stopped the host
falls back to a default.

## Common errors

| Symptom | Cause → fix |
| --- | --- |
| Installed, no build, nothing failing | `schemaStatus: "pending"` — awaiting approval |
| `failed` at boot with `MissingPermissionsError` | Grant the pairs in `.missing` and redeploy; if the app declares `object:create` / `object:field:create`, remove them |
| `failed` with `SchemaMismatchError` | The workspace changed after approval; `.missing` / `.conflicts` or `schemaPlan` name the gap |
| 400 on zip upload about a field or type | `schema.json` breaks a rule; show the message |
| 403 on apply | The clicker lacks `object:create` / `object:field:create` |
| `failed` with nixpacks output | No `start` script, stale lockfile, or unrecognised stack |
| Build succeeds, never `running` | Not listening on `PORT`, or bound to `localhost` |
| Frontend `api/...` calls return 404 | The app URL lacks the `/` before `#`, so relative paths resolve wrongly |
| 401 from `session()` | initData expired or belongs to another app; fetch a fresh one |
| 401/403 after a redeploy | The old key was cached; read `process.env.ERP_API_KEY` each time |
| Reads return 0 records although data exists | Row scope, not the filter |
| 409 updating a record | Version conflict; re-read and retry |
| 409 on install | The name's slug is taken in the workspace |
| 502 with docker output | A container operation failed; read the message |
