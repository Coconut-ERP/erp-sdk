# Triển khai & vận hành mini app

ERP build app bằng **nixpacks**, chạy thành container sau **Traefik**.

## Hợp đồng runtime

1. **Chạy được bằng lệnh start chuẩn của stack.** Node: có script `start` trong
   `package.json` (nixpacks chạy `npm i` → `npm start`). Stack khác theo quy ước
   nixpacks của stack đó (Go: build binary; Python: Procfile/uvicorn…).
2. **Nghe `process.env.PORT`, bind `0.0.0.0`.** Port khai lúc cài (mặc định
   3000) phải khớp — tốt nhất cứ đọc ENV.
3. **Đường dẫn tương đối.** App được serve dưới `/apps/<slug>-<id>/` qua
   Traefik: FE dùng `fetch("api/me")`, **không** `/api/me`; asset không hardcode
   root.
4. **Stateless với credential.** Đọc mọi thứ từ ENV, không ghi file cấu hình.

App viết bằng ngôn ngữ nào cũng được — nixpacks tự nhận diện stack. SDK này
phục vụ TypeScript/JavaScript; ngôn ngữ khác gọi thẳng REST API với cùng header.

## ENV được inject

| Biến | Ý nghĩa |
| --- | --- |
| `ERP_BASE_URL` | Base URL backend (SDK tự thêm `/api/v1`) |
| `ERP_API_KEY` | Key service account — **xoay vòng mỗi lần deploy** |
| `ERP_WORKSPACE_ID` | Workspace app được cài (tham khảo; key đã pin workspace) |
| `PORT` | Port app phải lắng nghe |

Cộng các biến tự khai lúc cài/sửa app (`PUT /mini-apps/:id`).

⚠️ **Đừng khai `ERP_ENV=development`.** Nó biến mọi lệnh ghi record thành dry
run — app chạy không lỗi nhưng không lưu gì. Không khai gì là đúng.

## Ba nguồn source

| Nguồn | Cách cài | Ship version mới |
| --- | --- | --- |
| `builtin` | `{ "source": "builtin", "templateKey": "..." }` — catalog `GET /mini-apps/templates` | `POST /:id/deploy` |
| `repo` | `{ "source": "repo", "repoUrl": "...", "repoBranch": "main" }` | push code → `POST /:id/deploy` |
| `zip` | multipart `POST /mini-apps`, field `file` | `PUT /:id/source` multipart `file` → tự redeploy |

Zip ≤ **25MB**, nén từ gốc project, loại `node_modules/` và `.git/`, **giữ
`schema.json`**:

```bash
zip -r app.zip . -x "node_modules/*" -x ".git/*"
```

Cài xong ERP **tự deploy lần đầu** — không cần gọi `/deploy`, trừ khi schema
chưa khớp.

## Màn duyệt `schema.json`

Backend so khai báo với workspace ở **mỗi lần cài và mỗi lần upload source**:

```
khai báo khớp sẵn      → schemaStatus "applied", build chạy như thường
khai báo thiếu thứ gì  → schemaStatus "pending",
                         statusMessage "Waiting for a review of schema.json",
                         KHÔNG có build nào được tạo
không có schema.json   → schemaStatus "none"
```

`POST /:id/deploy` trong lúc `pending` trả **409**. Poll build cũng vô nghĩa —
chưa có build nào tồn tại.

```
GET  /mini-apps/:id/schema        → { miniAppId, status, objects: [...] }
POST /mini-apps/:id/schema/apply  → MiniApp (đã "applied", build đã xếp hàng)
```

Cần RBAC `miniapp:manage` + item-ACL manage; app `sourceType: "external"` gọi
vào trả 409.

`GET /schema` **tính lại diff mỗi lần gọi** (workspace có thể vừa bị người khác
sửa) — mở màn duyệt là fetch lại, **đừng cache**.

`POST /schema/apply`:

- chỉ chạy khi `schemaStatus === "pending"`, ngược lại 409;
- chỉ **thêm** — không sửa, không xoá, không đổi type; bấm nhầm hai lần vô hại;
- tạo bằng quyền **người bấm** → cần `object:create` và/hoặc
  `object:field:create`, thiếu là 403;
- còn `conflict` nào thì 409 **trước khi** tạo bất cứ thứ gì, message nêu đúng
  field và hai kiểu lệch nhau;
- thành công → build được xếp hàng.

Người viết app soi trước, không cần đợi upload: `await app.schemaPlan(schema)`.

## Vòng đời trạng thái

```
cài / deploy ──► pending ──► building ──► running
                                │            │ stop
                                ▼            ▼
                              failed      stopped ──start──► running
```

- Poll `GET /mini-apps/:id` mỗi ~5s tới khi `running`/`failed`. Build đầu của
  một stack có thể vài phút (kéo base image), các lần sau thường <1 phút.
- `failed` → `statusMessage` chứa output build/deploy, đọc là ra lỗi.
- `start`/`stop` **bất đồng bộ**: response trả ngay, worker làm rồi cập nhật.
- `deploy` khi đang `building` → 409. `start`/`stop`/`logs` khi app chưa từng
  deploy thành công → 409.

## Vận hành

```
POST   /mini-apps/:id/deploy         build + chạy lại (rotate API key)
POST   /mini-apps/:id/start          chạy lại container đã stop
POST   /mini-apps/:id/stop           dừng (không xoá)
PUT    /mini-apps/:id                sửa name/description/port/env/repoBranch
                                     (áp dụng lần deploy sau)
GET    /mini-apps/:id/logs?tail=200  log container (504 nếu worker im 10s)
GET    /mini-apps/:id/schema         diff schema.json ⟷ workspace
POST   /mini-apps/:id/schema/apply   tạo phần còn thiếu + build
DELETE /mini-apps/:id                gỡ app: xoá container + service account
                                     (bảng dữ liệu KHÔNG bị xoá theo)
```

## Logo

Đặt `logo.webp` ở **root project** (cạnh `package.json`) và serve tại
`GET /logo.webp`:

```js
server.get("/logo.webp", (_req, res) =>
  res.sendFile("logo.webp", { root: process.cwd() }),
);
```

Deploy phát hiện file → API expose `logoUrl`. App stopped thì logo chết, UI app
chủ tự fallback.

## Lỗi thường gặp

| Triệu chứng | Nguyên nhân → cách xử |
| --- | --- |
| `failed` ngay sau cài, log `MissingPermissionsError` | Key thiếu quyền app khai. Cấp IAM rule đúng `.missing` cho service account rồi deploy lại. Nếu app khai `object:create`/`object:field:create` thì **bỏ đi** — mini app không bao giờ có |
| Cài xong app đứng yên, không có build | `schemaStatus: "pending"` — đang chờ duyệt `schema.json` |
| `failed`, log `SchemaMismatchError` | Workspace bị sửa sau khi duyệt. `.missing`/`.conflicts` (hoặc `schemaPlan`) chỉ đúng chỗ lệch |
| 400 lúc upload zip, message về field/type | `schema.json` sai luật (type lạ, computed, trùng tên, thiếu `config.targetObject`). Hiện thẳng message đó |
| 403 khi bấm áp dụng schema | Người bấm thiếu `object:create`/`object:field:create` — nhờ admin cấp rule hoặc bấm hộ |
| `failed`, statusMessage là output nixpacks | Build hỏng: thiếu script `start`, lockfile lệch, stack không nhận diện |
| Build ok nhưng không lên `running` | Không nghe đúng `PORT`, hoặc bind `localhost` thay vì `0.0.0.0` |
| App lên nhưng FE gọi `api/...` ra 404 | Mở app thiếu `/` trước `#` → fetch tương đối resolve sai path Traefik |
| 401 từ `session()` | initData hết hạn (5 phút) hoặc của app khác → FE xin chuỗi mới |
| 401/403 giữa chừng sau redeploy | App cache API key cũ; key đã rotate. Chỉ đọc `process.env.ERP_API_KEY` |
| 409 khi update/delete record | Version lệch (optimistic lock) — đọc lại record rồi thử lại |
| 409 khi cài | Tên app trùng slug trong workspace |
| 502 kèm output docker | Thao tác container lỗi — đọc message, kiểm tra worker |
| `logs` trả 504 | Worker không phản hồi trong 10s |
