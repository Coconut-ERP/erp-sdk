# User identity — initData & session

Mini apps run with their own API key, but need to know **who's clicking**.
Model is like Telegram Mini App: host app hands iframe a signed string; mini app trades it for verified identity. **User JWTs never go into mini apps.**

## Flow

```
Host app (logged-in user)
  │ POST /auth/miniapp/init-data { serviceAccountId }   ← target mini app's SA
  ▼
initData = "user=%7B...%7D&workspace_id=...&service_account_id=...
            &auth_date=...&hash=..."
  │ hand to iframe (URL fragment or postMessage)
  ▼
Mini app FE: send with every request to app server (header X-Init-Data)
  │
  ▼
Mini app server: app.session(initData)
  → backend verifies HMAC signature, 5-minute expiry, right API key for this app,
    user still member of workspace
  → { user, client, expiresIn }
```

Why it's secure:

- initData **grants no permissions by itself** — only apps holding the right API key can trade it.
  Leaked string is useless to others, and expires in 5 minutes.
- Each initData tied to **exactly one** app (service account id in the string) — different apps reject it.
- **No refresh token.** Session expires, frontend asks host for a new string — true Telegram re-launch model.

## Frontend

Browser helpers, import from `erp-sdk`, **don't need API key**:

```ts
import {
  readInitDataFromLocation, receiveInitData, parseInitData,
} from "erp-sdk";

// Option A: host puts in URL — <app url>/#erpInitData=<encoded>
const fromUrl = readInitDataFromLocation();   // reads both #erpInitData= and ?erpInitData=

// Option B: host postMessage { type: "erp-miniapp:init-data", initData }
const initData =
  fromUrl ??
  (await receiveInitData({
    allowedOrigins: ["https://erp.example.com"],   // "*" is rejected
    timeoutMs: 10_000,
  }));

// Display immediately — UNVERIFIED, display-only
const unsafe = parseInitData(initData);
unsafe.user?.displayName;

// Send with every request to app server
await fetch("api/leaves", { headers: { "X-Init-Data": initData } });
```

`parseInitData` doesn't verify the signature — browser doesn't have the secret. **All permission/data
decisions must be based on `session()` results on the server.**

When server returns 401 (session expired), ask for fresh string and retry:

```ts
window.parent.postMessage({ type: "erp-miniapp:request-init-data" }, "*");
const fresh = await receiveInitData({
  allowedOrigins: ["https://erp.example.com"],
});
```

ERP's host app already listens for `erp-miniapp:request-init-data` and replies with a new string
via postMessage — that's the bridge convention built-in.

## Server

Cache by initData string to avoid re-trading every request:

```ts
const sessions = new Map();

async function identify(initData) {
  const cached = sessions.get(initData);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const { user, client, expiresIn } = await app.session(initData);
  const entry = {
    user,
    client,
    expiresAt: Date.now() + Math.max(expiresIn - 60, 60) * 1000,
  };
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
    res.status(401).json({ error: e.message });   // FE asks for fresh initData
  }
});
```

Session expires, `session()` throws `ErpApiError` 401 → return 401 to FE to handle.
In-memory cache per container is fine; multiple instances each cache independently.

## Two permission models

### App authority — default, recommended

Data operations run on app's client (service account); `session()` only identifies *who*,
app writes user id into a field:

```ts
const { user } = req.erp;

await leaves.create({
  "Requester": user.id,        // identity written into data
  "Reason": req.body.reason,
  "Status": "pending",
});

// "only my leaves" is app logic
const mine = await leaves.records()
  .where("Requester", "equals", user.id)
  .fetchAll();
```

Anyone who can open the app gets full features, regardless of their individual role — like a
Telegram bot acting as bot. Trade-off: **data boundaries between users are the app's job**. Forgetting one `where` leaks other users' data.

### User authority — opt-in

```ts
const { user, client } = req.erp;
const leavesAsUser = await client.object("Leave Request");
await leavesAsUser.create({ ... });   // 403 if user can't write
```

Every call limited by that user's IAM permissions + row scope,
`createdBy` is the real user. Use when app must mirror ERP's actual per-user permissions.
Also available outside initData flow: `app.asUser(accessToken)`.

**Can mix**: read as `client` (see only permitted rows), write as `app`
(not blocked), per endpoint.

## Host app side (if you also write the embedding)

```ts
const { initData, expiresIn } = await hostClient.issueInitData(
  app.serviceAccountId,
);

// Option A — URL fragment. Remember "/" before "#"; fragment stays on browser.
iframe.src = `${app.url}/#erpInitData=${encodeURIComponent(initData)}`;

// Option B — postMessage, specific origin
import { sendInitDataToFrame } from "erp-sdk";
sendInitDataToFrame(iframe.contentWindow, initData, new URL(app.url).origin);
```

Missing "/" before "#" → relative fetch of FE uses wrong Traefik path → 404.

## Local development

No ENV injected, supply it; get initData using real user token, open app with fragment:

```bash
ERP_BASE_URL=http://localhost:8000 ERP_API_KEY=erp_sk_... PORT=4567 npm start
# POST /auth/miniapp/init-data with SA's serviceAccountId → initData string
# open http://localhost:4567/#erpInitData=<urlencoded>
```

## Security checklist

- [ ] Never receive/store user JWT in mini app — initData only.
- [ ] `receiveInitData` / `postMessage` always use specific origins (SDK rejects `"*"`).
- [ ] Never log initData to console/analytics — even if leaked, harmless, but still PII.
- [ ] Real authorization always server-side after `session()`; `parseInitData` is display-only.
- [ ] App authority: queries always `where` by **verified user id** —
      don't trust id from frontend.
- [ ] API key never to browser, never in output files, never in logs.
