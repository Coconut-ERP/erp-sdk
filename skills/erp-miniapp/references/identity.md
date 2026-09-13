# User identity — initData and sessions

A mini app runs on its own API key but still needs to know **who is clicking**. The
host hands the iframe a signed string; the app's server trades it for a verified
identity. User JWTs never reach a mini app.

## Contents

- [Flow](#flow)
- [Frontend](#frontend)
- [Server](#server)
- [Authority models](#authority-models)
- [Host side](#host-side)
- [Local development](#local-development)
- [Security checklist](#security-checklist)

## Flow

```
Host app (logged-in user)
  │ POST /auth/miniapp/init-data { serviceAccountId }   ← the target app's service account
  ▼
initData = "user=%7B…%7D&workspace_id=…&service_account_id=…&auth_date=…&hash=…"
  │ URL fragment or postMessage
  ▼
Mini app frontend → every request to its server with header X-Init-Data
  ▼
Mini app server: app.session(initData)
  → backend checks the HMAC, the 5-minute expiry, that this app's key is asking,
    and that the user is still a workspace member
  → { user, client, expiresIn }
```

- initData grants nothing by itself: only the app holding the matching key can trade
  it, and it expires in 5 minutes.
- Each string names exactly one service account, so other apps reject it.
- There is no refresh token; when a session ends, the frontend asks the host again.

## Frontend

The browser helpers need no API key:

```ts
import { readInitDataFromLocation, receiveInitData, parseInitData } from "erp-sdk";

// A: the host put it in the URL — <app url>/#erpInitData=<encoded> (or ?erpInitData=)
// B: the host posts { type: "erp-miniapp:init-data", initData }
const initData =
  readInitDataFromLocation() ??
  (await receiveInitData({ allowedOrigins: ["https://erp.example.com"], timeoutMs: 10_000 }));  // "*" is rejected

parseInitData(initData).user?.displayName;   // UNVERIFIED — display only

await fetch("api/leaves", { headers: { "X-Init-Data": initData } });
```

On a 401, ask the host for a fresh string — the ERP host already answers this message
— and retry:

```ts
window.parent.postMessage({ type: "erp-miniapp:request-init-data" }, "*");
const fresh = await receiveInitData({ allowedOrigins: ["https://erp.example.com"] });
```

## Server

```ts
const sessions = new Map();

async function identify(initData) {
  const cached = sessions.get(initData);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const { user, client, expiresIn } = await app.session(initData);
  const entry = { user, client, expiresAt: Date.now() + Math.max(expiresIn - 60, 60) * 1000 };
  sessions.set(initData, entry);
  return entry;
}

server.use("/api", async (req, res, next) => {
  const initData = req.header("x-init-data");
  if (!initData) return res.status(401).json({ error: "Missing X-Init-Data" });
  try {
    req.erp = await identify(initData);
    next();
  } catch (e) {
    res.status(401).json({ error: e.message });   // the frontend fetches fresh initData
  }
});
```

An expired string makes `session()` throw `ErpApiError` 401; pass it on as a 401. An
in-memory cache per container is fine, including with several instances.

## Authority models

**App authority** (default). Data calls run on the app's client; `session()` only says
who is acting, and the app writes that id into a field:

```ts
const { user } = req.erp;
await leaves.create({ Requester: user.id, Reason: req.body.reason, Status: "pending" });
const mine = await leaves.records().where("Requester", "equals", user.id).fetchAll();
```

Everyone who can open the app gets every feature, whatever their role — like a
Telegram bot. Separating users' data is the app's job: one forgotten `where` leaks it.

**User authority** (opt-in). Every call is bound by that user's IAM and row scope, and
`createdBy` is the real user:

```ts
const { client } = req.erp;
const leavesAsUser = await client.object("Leave Request");
await leavesAsUser.create({ Reason: req.body.reason });   // 403 if the user cannot write
```

Outside the initData flow, `app.asUser(accessToken)` does the same. The two can mix
per endpoint — read as `client` to see only permitted rows, write as `app`.

## Host side

Only when you also build the page that embeds the app:

```ts
const { initData } = await hostClient.issueInitData(app.serviceAccountId);

// A: URL fragment — keep the "/" before "#", or the app's relative fetches break
iframe.src = `${app.url}/#erpInitData=${encodeURIComponent(initData)}`;

// B: postMessage to one origin
import { sendInitDataToFrame } from "erp-sdk";
sendInitDataToFrame(iframe.contentWindow, initData, new URL(app.url).origin);
```

## Local development

Nothing is injected locally, so supply it:

```bash
ERP_BASE_URL=http://localhost:8000 ERP_API_KEY=erp_sk_... PORT=4567 npm start
# POST /auth/miniapp/init-data with the app's serviceAccountId, using a real user token
# open http://localhost:4567/#erpInitData=<urlencoded>
```

## Security checklist

- [ ] No user JWT is received or stored — initData only.
- [ ] `receiveInitData` and `postMessage` name specific origins.
- [ ] initData is never logged or sent to analytics.
- [ ] Every authorization decision happens on the server after `session()`.
- [ ] Under app authority, per-user queries filter on the verified user id.
- [ ] The API key never reaches the browser, output files or logs.
