# 09 — Hướng dẫn từng bước: app "Đơn xin nghỉ"

[← API reference](08-api-reference.md) · [Mục lục](README.md)

Xây từ đầu một mini app hoàn chỉnh: nhân viên mở app trong ERP, điền lý do +
khoảng ngày, đơn được ghi vào bảng "Đơn xin nghỉ" của workspace dưới danh
tính của chính họ. App dùng **app authority** (mô hình khuyến nghị): dữ liệu
ghi bằng quyền của app, user id đã xác minh được đóng dấu vào record.

Code hoàn chỉnh của app này nằm ở `examples/miniapp-leave-request` trong repo
ERP backend.

## Bước 0 — Khung project

```bash
mkdir miniapp-leave-request && cd miniapp-leave-request
npm init -y
npm install erp-sdk express
mkdir public
```

`package.json`:

```json
{
  "name": "miniapp-leave-request",
  "type": "module",
  "engines": { "node": ">=18" },
  "scripts": { "start": "node server.js" },
  "dependencies": { "erp-sdk": "^0.1.0", "express": "^4.19.2" }
}
```

## Bước 1 — Boot + khai quyền + provision bảng

`server.js` — phần đầu:

```js
import express from "express";
import { createMiniApp } from "erp-sdk";

const OBJECT_NAME = "Đơn xin nghỉ";
const PORT = Number(process.env.PORT ?? 3000);

const app = await createMiniApp({
  baseUrl: process.env.ERP_BASE_URL,
  apiKey: process.env.ERP_API_KEY,
  permissions: [
    { resource: "object", action: "read" },
    { resource: "object", action: "create" },
    { resource: "object:field", action: "read" },
    { resource: "object:field", action: "create" },
    { resource: "object:record", action: "read" },
    { resource: "object:record", action: "create" },
  ],
});

const leaves = await app.ensureObject(OBJECT_NAME, [
  { name: "Người xin nghỉ", type: "single_select", config: { source: "workspace_users" } },
  { name: "Lý do", type: "long_text" },
  { name: "Từ ngày", type: "date" },
  { name: "Đến ngày", type: "date" },
  { name: "Trạng thái", type: "single_select",
    config: { source: "static", options: ["pending", "approved", "rejected"] } },
]);
console.log(`[leave-request] object "${OBJECT_NAME}" ready`);
```

Vì sao thế này:

- `permissions` liệt kê đúng những gì app làm — key thiếu quyền thì app chết
  ngay lúc deploy với danh sách cần cấp, thay vì 403 lúc user bấm nút.
- `ensureObject` idempotent: lần deploy đầu tạo bảng, các lần sau thấy có
  rồi thì thôi; sau này thêm field vào danh sách là field mới tự được thêm.
- "Người xin nghỉ" kiểu `single_select` nguồn `workspace_users` — giá trị là
  user id, ERP UI hiển thị thành tên người.

## Bước 2 — Middleware danh tính (initData)

```js
const sessions = new Map();

async function sessionFor(initData) {
  const cached = sessions.get(initData);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const { user, expiresIn } = await app.session(initData);
  const entry = { user, expiresAt: Date.now() + Math.max(expiresIn - 60, 60) * 1000 };
  sessions.set(initData, entry);
  return entry;
}

const server = express();
server.use(express.json());
server.use(express.static("public"));

server.use("/api", async (req, res, next) => {
  const initData = req.header("x-init-data");
  if (!initData) return res.status(401).json({ error: "Missing X-Init-Data header" });
  try {
    req.erp = await sessionFor(initData);
    next();
  } catch (error) {
    res.status(401).json({ error: error.message });   // FE bắt 401 → xin initData mới
  }
});
```

FE gửi initData trong header `X-Init-Data` với **mọi** request `/api/*`.
Server đổi nó lấy user đã xác minh qua `app.session()` — cache theo chuỗi
để không gọi ERP mỗi request, trừ hao 60s trước hạn.

## Bước 3 — API của app

```js
server.get("/api/me", (req, res) => {
  const { id, email, displayName, fullName } = req.erp.user;
  res.json({ id, email, displayName, fullName });
});

server.get("/api/leaves", async (req, res) => {
  const { user } = req.erp;
  const records = await leaves.records()
    .where("Người xin nghỉ", "equals", user.id)     // ranh giới dữ liệu: app tự enforce
    .fetchAll();
  res.json(records
    .map((r) => leaves.rowFromRecord(r))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
});

server.post("/api/leaves", async (req, res) => {
  const { reason, from, to } = req.body ?? {};
  if (!reason || !from || !to) return res.status(400).json({ error: "reason, from, to are required" });
  const { user } = req.erp;
  const record = await leaves.create({
    "Người xin nghỉ": user.id,      // id ĐÃ XÁC MINH từ session — không tin body
    "Lý do": reason,
    "Từ ngày": from,
    "Đến ngày": to,
    "Trạng thái": "pending",
  });
  res.status(201).json(leaves.rowFromRecord(record));
});

server.listen(PORT, () => console.log(`[leave-request] listening on :${PORT}`));
```

Điểm mấu chốt của app authority: thao tác chạy trên `leaves` (client của
app) nên **user không cần bất kỳ quyền nào trên bảng** — nhưng chính vì thế
app phải tự `where` theo `user.id` khi đọc và tự đóng dấu `user.id` khi ghi.
Không bao giờ lấy user id từ body/query của FE.

## Bước 4 — Frontend

`public/index.html` (rút gọn phần khung):

```html
<!doctype html>
<meta charset="utf-8" />
<title>Đơn xin nghỉ</title>
<div id="app">Đang kết nối…</div>
<script type="module">
  const HOST_ORIGINS = ["http://localhost:3000", "https://erp.example.com"]; // origin app chủ

  // 1) Lấy initData: URL fragment trước, postMessage sau
  function fromLocation() {
    for (const raw of [location.hash.slice(1), location.search.slice(1)]) {
      const v = new URLSearchParams(raw).get("erpInitData");
      if (v) return v;
    }
  }
  function fromMessage(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      window.addEventListener("message", function onMsg(e) {
        if (!HOST_ORIGINS.includes(e.origin)) return;
        if (e.data?.type !== "erp-miniapp:init-data" || !e.data.initData) return;
        window.removeEventListener("message", onMsg); clearTimeout(t);
        resolve(e.data.initData);
      });
    });
  }
  let initData = fromLocation() ?? (await fromMessage());

  // 2) Mọi call kèm X-Init-Data, 401 thì xin app chủ cấp lại rồi thử lại
  async function api(path, options = {}) {
    const call = () => fetch(path, {                       // path TƯƠNG ĐỐI: "api/leaves"
      ...options,
      headers: { "Content-Type": "application/json", "X-Init-Data": initData, ...options.headers },
    });
    let res = await call();
    if (res.status === 401) {
      window.parent.postMessage({ type: "erp-miniapp:request-init-data" }, "*");
      initData = await fromMessage();
      res = await call();
    }
    if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
    return res.json();
  }

  // 3) UI
  const me = await api("api/me");
  const leaves = await api("api/leaves");
  document.querySelector("#app").innerHTML = `
    <h3>Xin chào ${me.displayName ?? me.email}</h3>
    <form id="f">
      <textarea name="reason" required placeholder="Lý do"></textarea>
      <input type="date" name="from" required /> <input type="date" name="to" required />
      <button>Gửi đơn</button>
    </form>
    <ul>${leaves.map((l) => `<li>${l["Từ ngày"]} → ${l["Đến ngày"]}: ${l["Lý do"]} — <b>${l["Trạng thái"]}</b></li>`).join("")}</ul>`;
  document.querySelector("#f").onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    await api("api/leaves", { method: "POST", body: JSON.stringify(d) });
    location.reload();
  };
</script>
```

(Nếu FE có bundler, dùng thẳng `readInitDataFromLocation` /
`receiveInitData({ allowedOrigins })` của SDK thay cho hai hàm tự viết.)

Hai quy tắc sống còn của FE:

- **fetch đường dẫn tương đối** (`api/me`, không `/api/me`) — app sống dưới
  `/apps/<slug>-<id>/` sau Traefik.
- **check `event.origin`** với danh sách origin app chủ cụ thể.

## Bước 5 — Logo (tuỳ chọn)

Đặt `logo.webp` cạnh `package.json` và:

```js
server.get("/logo.webp", (_req, res) => res.sendFile("logo.webp", { root: process.cwd() }));
```

ERP sẽ tự expose `logoUrl` cho màn danh sách app.

## Bước 6 — Chạy local

```bash
# Tạo SA + key dev (role admin cho nhanh):  POST /iam/service-accounts, POST /iam/service-accounts/:id/api-keys
ERP_BASE_URL=http://localhost:8000 ERP_API_KEY=erp_sk_... PORT=4567 npm start

# Giả lập user mở app: lấy initData bằng token user thật
curl -X POST "$ERP/api/v1/auth/miniapp/init-data" \
  -H "Authorization: Bearer <user token>" -H "X-Workspace-Id: <ws>" \
  -H "Content-Type: application/json" -d '{"serviceAccountId":"<sa id>"}'
# → mở http://localhost:4567/#erpInitData=<urlencode(initData)>
```

## Bước 7 — Cài lên ERP

```bash
zip -r leave-request.zip . -x "node_modules/*" -x ".git/*"
curl -X POST "$ERP/api/v1/mini-apps" \
  -H "Authorization: Bearer <admin token>" -H "X-Workspace-Id: <ws>" \
  -F "name=Đơn xin nghỉ" -F "port=3000" -F "role=admin" \
  -F "file=@leave-request.zip;type=application/zip"
```

`role=admin` vì app tự tạo bảng lúc boot ([cách siết chặt hơn](06-phan-quyen.md#chọn-role-lúc-cài-app--siết-quyền)).
Poll `GET /mini-apps/:id` tới `running`, mở `url` từ trong ERP — xong.

Ship bản mới: `PUT /mini-apps/:id/source` với zip mới, hoặc push repo rồi
`POST /mini-apps/:id/deploy`.

## Nâng cấp gợi ý

- **Màn duyệt đơn cho quản lý**: endpoint `GET /api/all` trả mọi đơn nhưng
  chỉ khi `req.erp.user` nằm trong danh sách duyệt (app tự định nghĩa), cùng
  `POST /api/leaves/:id/approve` — update record với optimistic lock
  (`update(id, { "Trạng thái": "approved" }, version)`).
- **Thống kê**: dùng [DataFrame](04-dataframe.md) — ví dụ cuối tài liệu đó
  chính là báo cáo cho bảng này.
- **User authority**: nếu muốn quyền ERP của từng người quyết định ai đọc
  được gì, đổi các thao tác đọc sang `client` từ `session()` — xem
  [05](05-danh-tinh-nguoi-dung.md#user-authority-opt-in).

---

[← API reference](08-api-reference.md) · [Mục lục](README.md)
