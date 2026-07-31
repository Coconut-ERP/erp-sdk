# Mini app: Đơn xin nghỉ

Example mini app for the ERP backend, built with `erp-sdk`. Employees
open it inside the main app, enter a reason and a date range, and a record is
created in the workspace's "Đơn xin nghỉ" table under their own identity.

It exercises the full mini app contract:

- boots with `ERP_BASE_URL` + `ERP_API_KEY` (+ `PORT`) injected by the Mini App
  module, and declares the permissions it needs (`createMiniApp` fails fast
  with the missing list otherwise)
- provisions its own table idempotently on startup (`ensureObject`)
- identifies the interacting user with Telegram-style initData: the frontend
  receives initData from the host (URL fragment or postMessage), sends it as
  `X-Init-Data`, and the server verifies it via `app.session(initData)`
- **app authority**: data operations run under the app's own service account,
  with the verified user id stamped into "Người xin nghỉ" — so anyone allowed
  to open the app can submit a request, regardless of their own object
  permissions (Telegram-bot model: the bot acts as the bot)

## Logo

Ship a `logo.webp` at the repo root (next to `package.json`) and serve it at
`GET /logo.webp` (this app does it with one `res.sendFile` route). The deploy
step detects the file and the mini app API exposes
`logoUrl = <app url>/logo.webp` — proxied by Traefik straight from the
running container, no object storage involved. The main app's UI should
fall back to a default icon on fetch error (app stopped ⇒ no logo).

## Deploy through the Mini App module

Zip the folder and upload it — no git host needed:

```bash
zip -r leave-request.zip . -x "node_modules/*" -x ".git/*"
curl -X POST "$ERP/api/v1/mini-apps" \
  -H "Authorization: Bearer <token>" -H "X-Workspace-Id: <ws>" \
  -F "name=Đơn xin nghỉ" -F "port=3000" -F "role=admin" \
  -F "file=@leave-request.zip;type=application/zip"
```

Ship a new version with `PUT /api/v1/mini-apps/:id/source` (same `file`
field) — it stores the zip and queues a redeploy.

Or push this folder to its own git repo and install from the link:

```
POST /api/v1/mini-apps
{ "name": "Đơn xin nghỉ", "source": "repo", "repoUrl": "<git url>", "port": 3000, "role": "admin" }
```

nixpacks detects node, runs `npm i` and `npm start`. The app appears at the
`url` returned by the API (Traefik). `role: "admin"` is the quick path because
the app creates objects/fields on first run; tighten it by using `member` plus
an IAM rule granting `object`/`object:field` create to the service account.

The SDK is vendored as `vendor/erp-sdk-0.1.0.tgz` so the repo is
self-contained; swap to the registry version once the SDK is published.

## Run locally

```bash
npm install
ERP_BASE_URL=http://localhost:8000 ERP_API_KEY=erp_sk_... PORT=4567 npm start
```

Create the service account + key via `POST /api/v1/iam/service-accounts` and
`POST /api/v1/iam/service-accounts/:id/api-keys`. To act as a user, fetch
initData with a user token via `POST /api/v1/auth/miniapp/init-data`
(`{"serviceAccountId": "..."}`) and open
`http://localhost:4567/#erpInitData=<urlencoded initData>` — or call the API
directly with the `X-Init-Data` header.
