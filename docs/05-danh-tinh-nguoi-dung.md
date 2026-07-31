# 05 — Danh tính người dùng: initData & session

[← DataFrame](04-dataframe.md) · [Mục lục](README.md) · [Tiếp: Phân quyền →](06-phan-quyen.md)

Mini app chạy bằng API key của chính nó — nhưng cần biết **người nào** đang
bấm nút. ERP giải quyết bằng mô hình **initData** của Telegram Mini App: app
chủ đưa cho iframe một chuỗi đã ký; mini app đổi chuỗi đó lấy danh tính user
đã xác minh. **JWT của user không bao giờ đi vào mini app.**

## Luồng đầy đủ

```
App chủ (user đã đăng nhập)
  │ POST /auth/miniapp/init-data { serviceAccountId }   ← SA của mini app đích
  ▼
initData = "user=%7B...%7D&workspace_id=...&service_account_id=...&auth_date=...&hash=..."
  │ đưa vào iframe (URL fragment hoặc postMessage)
  ▼
Mini app FE: đọc initData, gửi kèm mọi request về server app (vd header X-Init-Data)
  │
  ▼
Mini app server: app.session(initData)
  → backend kiểm chữ ký HMAC, hạn 5 phút, đúng API key app này,
    user còn là member workspace
  → { user, client, expiresIn }
```

Tính chất an toàn:

- initData **tự nó không cấp quyền gì** — chỉ mini app giữ đúng API key mới
  đổi được phiên (`POST /auth/miniapp/session` xác thực bằng key). Chuỗi bị
  lộ vô dụng với người khác, và chết sau 5 phút.
- Mỗi initData gắn với **một** app (service account id trong chuỗi) — app
  khác cầm cũng bị từ chối.
- Không có refresh token: phiên user (~15 phút) hết thì mini app **xin app
  chủ initData mới** — đúng mô hình re-launch của Telegram.

## Phía mini app — frontend

SDK có helpers browser (import từ `erp-sdk`, không cần API key):

```ts
import { readInitDataFromLocation, receiveInitData, parseInitData } from "erp-sdk";

// Cách A: app chủ nhét vào URL:  <app url>/#erpInitData=<encoded>
const fromUrl = readInitDataFromLocation();      // đọc cả #erpInitData= lẫn ?erpInitData=

// Cách B: app chủ postMessage { type: "erp-miniapp:init-data", initData }
const initData =
  fromUrl ??
  (await receiveInitData({
    allowedOrigins: ["https://erp.example.com"],  // bắt buộc origin cụ thể, "*" bị từ chối
    timeoutMs: 10_000,
  }));

// Hiển thị tức thì ("Xin chào An") — CHƯA XÁC MINH, chỉ dùng để hiển thị
const unsafe = parseInitData(initData);
console.log(unsafe.user?.displayName, unsafe.workspaceId);

// Gửi kèm mọi request về server của app
await fetch("api/leaves", { headers: { "X-Init-Data": initData } });
```

`parseInitData` không kiểm chữ ký — browser không có secret. Mọi quyết định
quyền/dữ liệu phải dựa trên kết quả `session()` phía server.

Khi phiên hết hạn (server trả 401), FE xin app chủ cấp lại rồi thử lại:

```ts
window.parent.postMessage({ type: "erp-miniapp:request-init-data" }, "*");
const fresh = await receiveInitData({ allowedOrigins: ["https://erp.example.com"] });
```

(App chủ của ERP đã lắng nghe message `erp-miniapp:request-init-data` và trả
initData mới qua postMessage — quy ước bridge của hệ thống.)

## Phía mini app — server

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
  try { req.erp = await identify(initData); next(); }
  catch (e) { res.status(401).json({ error: e.message }); }  // FE thấy 401 → xin initData mới
});
```

Cache theo chuỗi initData để không đổi phiên lại mỗi request; hết hạn thì
`session()` sẽ throw `ErpApiError` 401 → trả 401 cho FE xử lý.

## Dùng danh tính như thế nào — 2 mô hình

### App authority (mặc định, khuyến nghị)

`session()` chỉ để biết *ai*; thao tác dữ liệu vẫn chạy bằng `app` (service
account) và app tự ghi user id vào field:

```ts
const { user } = req.erp;
await leaves.create({
  "Người xin nghỉ": user.id,      // danh tính ghi vào dữ liệu
  "Lý do": req.body.reason,
  "Trạng thái": "pending",
});

// "chỉ đơn của tôi" là logic của app:
const mine = await leaves.records().where("Người xin nghỉ", "equals", user.id).fetchAll();
```

Ai mở được app là dùng được đủ chức năng, kể cả khi role cá nhân không ghi
được bảng — như Telegram bot: bot hành động với tư cách bot. Đổi lại, **ranh
giới dữ liệu giữa các user là trách nhiệm của app** (đừng quên `where` theo
user id).

### User authority (opt-in)

Dùng `client` từ `session()` — mọi call giới hạn theo IAM permission + row
scope của chính user, `createdBy` là user thật:

```ts
const { user, client } = req.erp;
const leavesAsUser = await client.object("Đơn xin nghỉ");
await leavesAsUser.create({ ... });   // 403 nếu user không có quyền ghi object này
```

Chọn khi app phải phản chiếu đúng quyền dữ liệu từng người của ERP. Có thể
trộn: đọc bằng `client`, ghi bằng `app`, tuỳ endpoint.

## Phía app chủ (tham khảo)

Nếu bạn cũng viết phần nhúng ở app chủ:

```ts
const { initData, expiresIn } = await hostClient.issueInitData(app.serviceAccountId);

// Cách A — URL fragment (nhớ "/" trước "#", fragment không đi lên server):
iframe.src = `${app.url}/#erpInitData=${encodeURIComponent(initData)}`;

// Cách B — postMessage, origin cụ thể:
import { sendInitDataToFrame } from "erp-sdk";
sendInitDataToFrame(iframe.contentWindow!, initData, new URL(app.url).origin);
```

Chi tiết đầy đủ phía app chủ (poll trạng thái, component React mẫu) nằm ở
tài liệu FE của ERP backend (`docs/miniapp-fe-guide.md` trong repo backend).

## Checklist bảo mật

- [ ] Không bao giờ nhận/lưu JWT của user trong mini app — chỉ initData.
- [ ] `receiveInitData`/`postMessage` luôn dùng origin cụ thể (SDK từ chối `"*"`).
- [ ] Không log initData ra console/analytics (dù lộ cũng không đổi được phiên, nhưng vẫn là PII).
- [ ] Mọi authorization thật nằm server-side sau `session()`; `parseInitData` chỉ để hiển thị.
- [ ] App authority: mọi query theo user phải `where` theo user id đã xác minh — không tin id do FE tự gửi.

---

[← DataFrame](04-dataframe.md) · [Mục lục](README.md) · [Tiếp: Phân quyền →](06-phan-quyen.md)
