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
3. **Absolute paths are fine.** Each app gets its own subdomain — a Traefik
   `Host()` router with nothing rewritten — so it is its own origin at the root
   path, not a path prefix behind the ERP's. `fetch("/api/me")` and root-relative
   assets both resolve correctly.
4. **Credentials from the environment only**, never written to config files.

| Injected | Meaning |
| --- | --- |
| `ERP_BASE_URL` | Backend URL (the SDK adds `/api/v1`) |
| `ERP_API_KEY` | Service-account key — **rotates on every deploy** |
| `ERP_WORKSPACE_ID` | The install's workspace (the key already pins it) |
| `PORT` | The port to listen on |

Custom variables are set at install or with `PUT /mini-apps/:id/env` (a dedicated,
write-only endpoint — values come back as `***`, and `[KEEP]` in a whole-map PUT
means "keep what's already stored under this name"). `PUT /mini-apps/:id` itself
only covers `name`, `description`, `externalUrl` and `port`. Never set
`ERP_ENV=development` in the env: every record write would silently become a dry
run.

## Install sources

Only two `source` values exist — anything else is a 400:

| Source | Install | New version |
| --- | --- | --- |
| `zip` | multipart `POST /mini-apps`, field `file` | multipart `PUT /:id/source`, field `file` — redeploys |
| `external` | JSON body naming a URL the developer already runs themselves — **not built, hosted or fetched server-side**; only the importer sees or removes it, and it can't be shared workspace-wide | n/a — edit the URL and reopen it |

A zip is built from the project root without `node_modules/` or `.git/`, capped at
20,000 entries and 1 GiB uncompressed, and keeps `schema.json`:

```bash
zip -r app.zip . -x "node_modules/*" -x ".git/*"
```

The first deploy after install is automatic unless the schema is pending.
`external` apps land in status `development` and reject deploy/start/stop/logs/source
upload with 409 — there is nothing here to build.

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
PUT    /mini-apps/:id                name, description, externalUrl, port — applied on the next deploy
PUT    /mini-apps/:id/env            env vars — write-only, `[KEEP]` keeps a stored value
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
| 401 from `session()` | initData expired or belongs to another app; fetch a fresh one |
| 401/403 after a redeploy | The old key was cached; read `process.env.ERP_API_KEY` each time |
| Reads return 0 records although data exists | Row scope, not the filter |
| 409 updating a record | Version conflict; re-read and retry |
| 409 on install | The name's slug is taken in the workspace |
| 502 with docker output | A container operation failed; read the message |
