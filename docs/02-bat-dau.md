# 02 — Bắt đầu: mini app đầu tiên

[← Tổng quan](01-tong-quan.md) · [Mục lục](README.md) · [Tiếp: Dữ liệu →](03-du-lieu.md)

Mục tiêu: một app "Hello" chạy local, gọi được ERP, rồi đóng gói cài lên
workspace. Cần: Node 18+, một tài khoản ERP có quyền admin trong workspace.

## 1. Dựng project

```bash
mkdir hello-miniapp && cd hello-miniapp
npm init -y
npm install https://github.com/Coconut-ERP/erp-sdk/releases/download/v0.3.1/erp-sdk.tgz express
```

SDK không nằm trên npm registry — nó là tarball trong GitHub Release, cài bằng
URL nên package manager nào cũng chạy. Xem [Cài đặt SDK](README.md#cài-đặt-sdk).

`package.json` cần hai điều bắt buộc với deploy:

```json
{
  "type": "module",
  "scripts": { "start": "node server.js" }
}
```

- `"start"` — nixpacks build app Node bằng `npm i` rồi chạy `npm start`.
  Không có script start = deploy fail.
- App **phải lắng nghe trên `process.env.PORT`** — ERP quyết định port và
  route Traefik theo nó.

## 2. Viết server

`server.js`:

```js
import express from "express";
import { createMiniApp } from "erp-sdk";

const PORT = Number(process.env.PORT ?? 3000);

const app = await createMiniApp({
  baseUrl: process.env.ERP_BASE_URL,
  apiKey: process.env.ERP_API_KEY,
  permissions: [
    { resource: "object", action: "read" },
    { resource: "object:record", action: "read" },
  ],
});

const me = await app.me();
console.log(`Booted as service account: ${me.email}`);

const server = express();
server.get("/", async (_req, res) => {
  const objects = await app.objects();
  res.send(`<h1>Hello mini app</h1>
    <p>Workspace có ${objects.length} bảng:</p>
    <ul>${objects.map((o) => `<li>${o.name}</li>`).join("")}</ul>`);
});

server.listen(PORT, () => console.log(`listening on :${PORT}`));
```

Ba dòng đáng chú ý:

- `createMiniApp` **kiểm tra key ngay lúc boot** với danh sách `permissions`
  đã khai — thiếu quyền nào throw `MissingPermissionsError` liệt kê đúng
  quyền đó. App hỏng cấu hình chết ngay lúc deploy, không chết giữa chừng
  khi user đang dùng.
- Không truyền `workspaceId` — API key tự pin workspace của nó ở backend.
- `app.objects()` / `app.object(name)` được cache; xem [03](03-du-lieu.md).

## 3. Chạy local

Local chưa có ENV do ERP inject, nên tự cấp một API key để dev:

1. Tạo service account + key trong ERP (cần quyền admin):

```bash
# POST /api/v1/iam/service-accounts        { "name": "hello-dev" }
# POST /api/v1/iam/service-accounts/:id/api-keys
# → trả erp_sk_...  (chỉ hiện một lần, lưu lại)
```

2. Chạy:

```bash
ERP_BASE_URL=http://localhost:8000 ERP_API_KEY=erp_sk_... PORT=4567 npm start
# → mở http://localhost:4567
```

Nếu boot ném `MissingPermissionsError`: gắn IAM rule cấp các quyền còn thiếu
cho service account (hoặc tạo SA với role admin khi dev cho nhanh — nhưng nhớ
app thật chạy bằng `member`, đừng dựa vào quyền dev không có ở production).

## 4. Cài lên ERP

Ba cách đưa source vào — cùng endpoint `POST /mini-apps`, cài xong ERP **tự
deploy lần đầu**:

**Upload zip** (không cần git host):

```bash
zip -r hello.zip . -x "node_modules/*" -x ".git/*"

curl -X POST "$ERP/api/v1/mini-apps" \
  -H "Authorization: Bearer <token>" -H "X-Workspace-Id: <ws>" \
  -F "name=Hello" -F "port=3000" -F "role=member" \
  -F "file=@hello.zip;type=application/zip"
```

Zip tối đa 25MB — luôn loại `node_modules/` và `.git/`.

**Từ repo git:**

```bash
curl -X POST "$ERP/api/v1/mini-apps" \
  -H "Authorization: Bearer <token>" -H "X-Workspace-Id: <ws>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Hello","source":"repo","repoUrl":"https://github.com/you/hello-miniapp","repoBranch":"main","port":3000,"role":"member"}'
```

**Từ template có sẵn:** `GET /mini-apps/templates` rồi
`{"source":"builtin","templateKey":"..."}`.

Về `role`: quyền của service account app, chỉ còn `member` (đọc/ghi record —
mặc định, hợp với hầu hết app) hoặc `viewer` (chỉ đọc — app dashboard/báo cáo).
`admin` đã bị loại bỏ; truyền vào là `400`.

App cần bảng riêng thì **không tự tạo** mà khai trong `schema.json` ở gốc zip:

```json
{ "objects": [ { "name": "Đơn xin nghỉ", "fields": [ { "name": "Lý do", "type": "long_text" } ] } ] }
```

```js
// soi cú pháp trước khi zip — hàm thuần, không cần credential
import { readFileSync } from "node:fs";
import { validateSchema } from "erp-sdk";
console.log(validateSchema(JSON.parse(readFileSync("schema.json", "utf8"))));  // [] = ổn
```

Nếu workspace chưa có đủ, response cài app trả `schemaStatus: "pending"` và
**chưa build gì cả** — mở màn duyệt schema, áp dụng, rồi mới tới bước 5. Xem
[03 — Dữ liệu](03-du-lieu.md#khai-báo-schema--schemajson).

## 5. Chờ build & mở app

```bash
# Poll tới khi status = running | failed
curl "$ERP/api/v1/mini-apps/<appId>" -H ... 
# pending → building → running   (build đầu có thể vài phút, sau đó <1 phút)
```

Trước khi poll, kiểm tra `schemaStatus`: `"pending"` nghĩa là chưa có build nào
được xếp hàng, poll bao lâu cũng không đổi — phải duyệt schema trước.

Khi `running`, response có `url` — app sống tại `<MINIAPP_PUBLIC_URL>/apps/<slug>-<id>`
sau Traefik. `failed` thì `statusMessage` chứa output build để debug, và
`GET /mini-apps/:id/logs?tail=200` xem log container.

Ship version mới: `PUT /mini-apps/:id/source` (multipart, field `file` = zip
mới) — tự redeploy. Hoặc `POST /mini-apps/:id/deploy` để build lại từ source
hiện tại (repo thì pull lại branch).

## 6. Tiếp theo

- App cần bảng dữ liệu riêng → [03 — Dữ liệu](03-du-lieu.md), phần `schema.json`.
- App cần biết ai đang dùng → [05 — Danh tính người dùng](05-danh-tinh-nguoi-dung.md).
- Làm một app hoàn chỉnh có UI → [09 — Tutorial "Đơn xin nghỉ"](09-tutorial-leave-request.md).
- Deploy sâu hơn (ENV, logo, logs, lỗi hay gặp) → [07 — Triển khai & vận hành](07-trien-khai-van-hanh.md).

---

[← Tổng quan](01-tong-quan.md) · [Mục lục](README.md) · [Tiếp: Dữ liệu →](03-du-lieu.md)
