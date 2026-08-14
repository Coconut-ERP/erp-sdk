---
name: erp-miniapp
description: Dựng mini app chạy trên ERP 1kk bằng erp-sdk — web app dùng ERP làm engine thay cho database riêng. Dùng khi task nhắc tới mini app / miniapp ERP, erp init, schema.json, assertSchema, initData / X-Init-Data / session(), createMiniApp + permissions, service account erp_sk_, deploy app lên ERP (zip/repo/template), duyệt schema khi deploy, hoặc khi người dùng muốn "viết app quản lý X trên ERP", "app đơn xin nghỉ", "app chấm công", "làm form nhập liệu cho nhân viên", "app xem báo cáo cho sếp", "dựng web app không cần database". Chỉ đọc/ghi/phân tích dữ liệu trên workspace có sẵn (script, báo cáo, import) thì dùng skill erp-data.
---

# Dựng mini app trên ERP

Mini app là **web app nhỏ, cài theo từng workspace**, mở từ trong giao diện ERP
(iframe) và dùng ERP làm engine: dữ liệu, phân quyền, danh tính người dùng đều
lấy từ ERP thay vì tự xây. Giống Telegram Mini App.

Hai nửa: **server** (bắt buộc — giữ API key, gọi ERP qua SDK, serve frontend) và
**frontend** (tuỳ app — chạy trong iframe, nhận initData, gọi về server của
chính app). API key **chỉ ở server**, không bao giờ xuống browser.

## Ba ràng buộc quyết định mọi thiết kế

Đọc kỹ ba dòng này trước khi viết dòng code nào — chúng là nguồn của hầu hết lỗi:

1. **App không tạo được bảng.** Service account của app là `member`/`viewer`,
   gọi `POST /objects` là 403. App **khai báo** bảng cần trong `schema.json`;
   người deploy duyệt và tạo bằng quyền của *họ*. → §2
2. **App không nhận JWT của user.** Nó nhận `initData` đã ký, đổi lấy danh tính
   qua `session()`. → §3
3. **API key xoay vòng mỗi lần deploy.** Luôn đọc `process.env.ERP_API_KEY`,
   không hardcode, không cache ra ngoài env. → §4

## 1. Khởi động một app

```bash
npx erp init don-xin-nghi --name "Đơn xin nghỉ" --object "Đơn xin nghỉ"
```

Sinh sẵn `server.js` (Express + bridge initData), `schema.json`, `public/index.html`,
`.env.example`, `README.md`. Chạy được ngay — sửa dần từ đó thay vì viết từ đầu.

Khung boot chuẩn, **thứ tự này là bắt buộc**:

```ts
import { readFileSync } from "node:fs";
import { createMiniApp } from "erp-sdk";

const schema = JSON.parse(
  readFileSync(new URL("./schema.json", import.meta.url), "utf8"),
);

// 1. Kết nối + preflight quyền: thiếu quyền là chết ngay lúc boot,
//    không chết giữa luồng user.
const app = await createMiniApp({
  baseUrl: process.env.ERP_BASE_URL,
  apiKey: process.env.ERP_API_KEY,
  permissions: [
    { resource: "object", action: "read" },
    { resource: "object:field", action: "read" },
    { resource: "object:record", action: "read" },
    { resource: "object:record", action: "create" },
  ],
});

// 2. Chặn boot nếu workspace chưa khớp schema.json — một lỗi rõ ràng,
//    thay vì UnknownFieldError rơi rớt ở từng route.
const { "Đơn xin nghỉ": leaves } = await app.assertSchema(schema);
```

Khai đúng quyền app dùng, **đừng khai `*`**, và **đừng khai `object:create` /
`object:field:create`** — service account không bao giờ có chúng, khai vào là
app chết lúc boot với `MissingPermissionsError`.

## 2. `schema.json` — khai báo, không tạo

File ở **gốc source**. Mỗi object = body của `POST /objects` cộng `fields`:

```json
{
  "objects": [
    {
      "name": "Đơn xin nghỉ",
      "fields": [
        { "name": "Người xin nghỉ", "type": "single_select",
          "config": { "source": "workspace_users" } },
        { "name": "Lý do", "type": "long_text" },
        { "name": "Trạng thái", "type": "single_select",
          "config": { "source": "static", "options": ["pending", "approved"] } }
      ]
    }
  ]
}
```

Kiểm **trước khi** upload — hàm thuần, không cần credential:

```js
import { validateSchema } from "erp-sdk";
validateSchema(schema);            // string[] mọi lỗi backend sẽ bắt; [] = hợp lệ
await app.schemaPlan(schema);      // diff với workspace thật, không throw
```

Luật hay vi phạm: `formula`/`lookup`/`rollup` **không khai báo được**;
`relation` cần `config.targetObject` là **tên bảng**; chỉ **thêm** được, đổi
kiểu field đã có là `conflict` phải sửa tay. Chi tiết + toàn bộ 18 field type:
`references/schema.md`.

## 3. Biết ai đang dùng app

```ts
server.use("/api", async (req, res, next) => {
  const initData = req.header("x-init-data");
  if (!initData) return res.status(401).json({ error: "Missing X-Init-Data" });
  try {
    req.erp = await identify(initData);   // cache theo chuỗi initData
    next();
  } catch (e) {
    res.status(401).json({ error: e.message });   // FE xin app chủ initData mới
  }
});
```

initData sống **5 phút**, không có refresh token — 401 là chuyện bình thường,
FE phải xử lý được. Frontend đọc chuỗi bằng `readInitDataFromLocation()` hoặc
`receiveInitData({ allowedOrigins })`; `parseInitData()` **chưa xác minh**, chỉ
để hiển thị "Xin chào An". Luồng đầy đủ + code FE: `references/identity.md`.

**Hai mô hình quyền — chọn sớm, đừng trộn nhầm:**

| | App authority (mặc định) | User authority (opt-in) |
| --- | --- | --- |
| Chạy bằng | client của app (service account) | `session(initData).client` / `asUser(token)` |
| `createdBy` | service account | user thật |
| Quyền | ai mở được app là dùng đủ chức năng | đúng RBAC + row scope của user đó |
| Ranh giới dữ liệu giữa user | **app tự làm** bằng `where` | server tự cắt |

App authority là mặc định khuyến nghị (kiểu Telegram bot). Đổi lại, mọi query
theo user **phải** `where` theo user id đã xác minh từ `session()` — không bao
giờ tin id do FE gửi lên:

```ts
const { user } = req.erp;
await leaves.create({ "Người xin nghỉ": user.id, "Lý do": req.body.reason });
const mine = await leaves.records()
  .where("Người xin nghỉ", "equals", user.id)   // quên dòng này = lộ dữ liệu
  .fetchAll();
```

## 4. Hợp đồng runtime khi deploy

ERP build bằng nixpacks, chạy container sau Traefik. App hợp lệ khi:

- có script `start` (Node: nixpacks chạy `npm i` → `npm start`);
- **nghe `process.env.PORT`, bind `0.0.0.0`** — không phải `localhost`;
- **URL tương đối** ở FE (`fetch("api/me")`, không phải `/api/me`) — app được
  serve dưới path `/apps/<slug>-<id>/`;
- đọc mọi credential từ ENV, không ghi ra file.

ERP inject `ERP_BASE_URL`, `ERP_API_KEY`, `ERP_WORKSPACE_ID`, `PORT`.

⚠️ **Đừng bao giờ khai `ERP_ENV=development` cho app đã cài.** Biến đó biến mọi
lệnh ghi record thành dry run: app chạy không lỗi nhưng không có gì được lưu —
kiểu hỏng khó nhìn ra nhất. Không khai gì là đúng.

Cài xong ERP tự deploy, **trừ khi** `schema.json` chưa khớp workspace: app dừng
ở `schemaStatus: "pending"` và **không có build nào được tạo** cho tới khi người
deploy bấm duyệt. Vòng đời, ba nguồn source (template/repo/zip), bảng lỗi đầy
đủ: `references/deploy.md`.

## Bẫy đã trả giá

- **App đứng yên sau khi cài, không có build** → `schemaStatus: "pending"`, đang
  chờ duyệt `schema.json`. Không phải build hỏng.
- **`MissingPermissionsError` lúc boot** → key thiếu quyền đã khai, hoặc app khai
  `object:create` (mini app không bao giờ có). Đọc `.missing`.
- **FE gọi `api/...` ra 404** → app chủ mở app thiếu `/` trước `#`, fetch tương
  đối resolve sai path Traefik.
- **401/403 sau redeploy** → app cache API key cũ; key đã rotate.
- **Build ok nhưng không lên `running`** → bind `localhost` thay vì `0.0.0.0`,
  hoặc không nghe `PORT`.
- **Field `relation` ghi là thay cả list**, không phải thêm — `[]` xoá sạch link,
  `null` giữ nguyên. Xem skill `erp-data`.
- **Đọc ra 0 record dù có dữ liệu** → row scope IAM, không phải filter sai.

Trước khi sửa cấu trúc workspace của người dùng (tạo bảng, đổi field bằng key
admin): **hỏi**. Đó không phải việc của app.

## Tham chiếu

- `references/schema.md` — `schema.json`: format, 18 field type, luật backend,
  `validateSchema`/`planSchema`/`assertSchema`, đổi schema về sau.
- `references/identity.md` — initData đầy đủ: luồng ký, code FE + server, cache
  phiên, hai mô hình quyền, checklist bảo mật.
- `references/deploy.md` — hợp đồng runtime, ba nguồn source, màn duyệt schema,
  vòng đời trạng thái, ENV, logo, bảng lỗi thường gặp.
- Đọc/ghi/phân tích dữ liệu (query, DataFrame, SQL, workflow) → skill **`erp-data`**.
