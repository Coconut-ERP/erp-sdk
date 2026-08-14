# Danh tính người dùng — initData & session

Mini app chạy bằng API key của chính nó, nhưng cần biết **người nào** đang bấm.
Mô hình giống Telegram Mini App: app chủ đưa iframe một chuỗi đã ký; mini app
đổi chuỗi đó lấy danh tính đã xác minh. **JWT của user không bao giờ đi vào mini
app.**

## Luồng

```
App chủ (user đã đăng nhập)
  │ POST /auth/miniapp/init-data { serviceAccountId }   ← SA của mini app đích
  ▼
initData = "user=%7B...%7D&workspace_id=...&service_account_id=...
            &auth_date=...&hash=..."
  │ đưa vào iframe (URL fragment hoặc postMessage)
  ▼
Mini app FE: gửi kèm mọi request về server app (header X-Init-Data)
  │
  ▼
Mini app server: app.session(initData)
  → backend kiểm chữ ký HMAC, hạn 5 phút, đúng API key app này,
    user còn là member workspace
  → { user, client, expiresIn }
```

Vì sao an toàn:

- initData **tự nó không cấp quyền gì** — chỉ app giữ đúng API key mới đổi được
  phiên. Chuỗi bị lộ là vô dụng với người khác, và chết sau 5 phút.
- Mỗi initData gắn với **một** app (service account id nằm trong chuỗi) — app
  khác cầm cũng bị từ chối.
- **Không có refresh token.** Phiên hết thì FE xin app chủ chuỗi mới — đúng mô
  hình re-launch của Telegram.

## Frontend

Helpers browser, import từ `erp-sdk`, **không cần API key**:

```ts
import {
  readInitDataFromLocation, receiveInitData, parseInitData,
} from "erp-sdk";

// Cách A: app chủ nhét vào URL — <app url>/#erpInitData=<encoded>
const fromUrl = readInitDataFromLocation();   // đọc cả #erpInitData= lẫn ?erpInitData=

// Cách B: app chủ postMessage { type: "erp-miniapp:init-data", initData }
const initData =
  fromUrl ??
  (await receiveInitData({
    allowedOrigins: ["https://erp.example.com"],   // "*" bị từ chối
    timeoutMs: 10_000,
  }));

// Hiển thị tức thì — CHƯA XÁC MINH, chỉ để hiển thị
const unsafe = parseInitData(initData);
unsafe.user?.displayName;

// Gửi kèm mọi request về server của chính app
await fetch("api/leaves", { headers: { "X-Init-Data": initData } });
```

`parseInitData` không kiểm chữ ký — browser không có secret. **Mọi quyết định
quyền/dữ liệu phải dựa trên kết quả `session()` phía server.**

Khi server trả 401 (phiên hết hạn), xin lại rồi thử lại:

```ts
window.parent.postMessage({ type: "erp-miniapp:request-init-data" }, "*");
const fresh = await receiveInitData({
  allowedOrigins: ["https://erp.example.com"],
});
```

App chủ của ERP đã lắng nghe `erp-miniapp:request-init-data` và trả chuỗi mới
qua postMessage — đó là quy ước bridge của hệ thống.

## Server

Cache theo chuỗi initData để không đổi phiên lại mỗi request:

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
    res.status(401).json({ error: e.message });   // FE xin initData mới
  }
});
```

Hết hạn thì `session()` throw `ErpApiError` 401 → trả 401 cho FE xử lý. Map
trong RAM là đủ cho một container; nhiều instance thì mỗi instance tự cache.

## Hai mô hình quyền

### App authority — mặc định, khuyến nghị

Thao tác dữ liệu chạy bằng client của app (service account); `session()` chỉ để
biết *ai*, app tự ghi user id vào field:

```ts
const { user } = req.erp;

await leaves.create({
  "Người xin nghỉ": user.id,        // danh tính ghi vào dữ liệu
  "Lý do": req.body.reason,
  "Trạng thái": "pending",
});

// "chỉ đơn của tôi" là logic của app
const mine = await leaves.records()
  .where("Người xin nghỉ", "equals", user.id)
  .fetchAll();
```

Ai mở được app là dùng được đủ chức năng, kể cả khi role cá nhân của họ không
ghi được bảng đó — như Telegram bot hành động với tư cách bot. Đổi lại: **ranh
giới dữ liệu giữa các user là trách nhiệm của app**. Quên một `where` là lộ dữ
liệu của người khác.

### User authority — opt-in

```ts
const { user, client } = req.erp;
const leavesAsUser = await client.object("Đơn xin nghỉ");
await leavesAsUser.create({ ... });   // 403 nếu user không có quyền ghi
```

Mọi call bị giới hạn theo IAM permission + row scope của chính user,
`createdBy` là user thật. Chọn khi app phải phản chiếu đúng quyền dữ liệu từng
người của ERP. Cũng lấy được ngoài luồng initData: `app.asUser(accessToken)`.

**Trộn được**: đọc bằng `client` (thấy đúng phần được phép), ghi bằng `app`
(không bị chặn), tuỳ endpoint.

## Phía app chủ (nếu bạn cũng viết phần nhúng)

```ts
const { initData, expiresIn } = await hostClient.issueInitData(
  app.serviceAccountId,
);

// Cách A — URL fragment. Nhớ "/" trước "#"; fragment không đi lên server.
iframe.src = `${app.url}/#erpInitData=${encodeURIComponent(initData)}`;

// Cách B — postMessage, origin cụ thể
import { sendInitDataToFrame } from "erp-sdk";
sendInitDataToFrame(iframe.contentWindow, initData, new URL(app.url).origin);
```

Thiếu `/` trước `#` làm fetch tương đối của FE resolve sai path Traefik → 404.

## Chạy local

Không có ENV inject, tự cấp; lấy initData bằng token user thật rồi mở app kèm
fragment:

```bash
ERP_BASE_URL=http://localhost:8000 ERP_API_KEY=erp_sk_... PORT=4567 npm start
# POST /auth/miniapp/init-data với serviceAccountId của SA dev → chuỗi initData
# mở http://localhost:4567/#erpInitData=<urlencoded>
```

## Checklist bảo mật

- [ ] Không nhận/lưu JWT của user trong mini app — chỉ initData.
- [ ] `receiveInitData` / `postMessage` luôn dùng origin cụ thể (SDK từ chối `"*"`).
- [ ] Không log initData ra console/analytics — dù lộ cũng vô hại, nhưng vẫn là PII.
- [ ] Mọi authorization thật nằm server-side sau `session()`; `parseInitData` chỉ
      để hiển thị.
- [ ] App authority: query theo user luôn `where` theo **user id đã xác minh** —
      không tin id do FE gửi lên.
- [ ] API key không bao giờ xuống browser, không vào file kết quả, không vào log.
