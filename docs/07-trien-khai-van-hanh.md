# 07 — Triển khai & vận hành

[← Phân quyền](06-phan-quyen.md) · [Mục lục](README.md) · [Tiếp: API reference →](08-api-reference.md)

## Hợp đồng runtime — app phải tuân thủ gì?

ERP build app bằng **nixpacks** và chạy thành container sau **Traefik**. App
hợp lệ khi:

1. **Chạy được bằng lệnh start chuẩn của stack.** Node: có script
   `"start"` trong package.json (nixpacks chạy `npm i` → `npm start`).
   Stack khác theo quy ước nixpacks của stack đó (Go: build binary,
   Python: Procfile/uvicorn…).
2. **Lắng nghe trên `process.env.PORT`**, bind `0.0.0.0`. Port khai lúc cài
   (`port`, mặc định 3000) phải khớp — nhưng tốt nhất app cứ đọc ENV.
3. **Đường dẫn tương đối.** App được serve dưới path `/apps/<slug>-<id>/`
   qua Traefik — FE dùng URL tương đối (`api/me`, không phải `/api/me`),
   asset không hardcode root. App chủ luôn mở app với dấu `/` cuối để
   fetch tương đối resolve đúng.
4. **Stateless với credential**: đọc mọi thứ từ ENV, không ghi file cấu hình.

### ENV được inject vào container

| Biến | Ý nghĩa |
| --- | --- |
| `ERP_BASE_URL` | Base URL backend ERP (SDK tự thêm `/api/v1`) |
| `ERP_API_KEY` | API key service account của app — **xoay vòng mỗi lần deploy** |
| `ERP_WORKSPACE_ID` | Workspace app được cài (tham khảo; key đã tự pin workspace) |
| `PORT` | Port app phải lắng nghe |

Cộng thêm các biến tự khai trong `env` lúc cài/sửa app (`PUT /mini-apps/:id`).

## Ba nguồn source

| Nguồn | Cách cài | Ship version mới |
| --- | --- | --- |
| `builtin` | `{ "source": "builtin", "templateKey": "..." }` — catalog `GET /mini-apps/templates` | `POST /:id/deploy` (pull template) |
| `repo` | `{ "source": "repo", "repoUrl": "...", "repoBranch": "main" }` | push code → `POST /:id/deploy` |
| `zip` | multipart `POST /mini-apps` với field `file` (không cần field `source`) | `PUT /:id/source` multipart `file` = zip mới → tự redeploy |

Zip tối đa **25MB**, nén từ thư mục gốc project, loại `node_modules/` và
`.git/`:

```bash
zip -r app.zip . -x "node_modules/*" -x ".git/*"
```

Cài xong ERP **tự deploy lần đầu** — không cần gọi `/deploy` thêm, **trừ khi**
source có `schema.json` mà workspace chưa đáp ứng: khi đó app dừng ở
`schemaStatus: "pending"` và chờ duyệt (mục kế tiếp).

## Duyệt `schema.json` khi deploy

Mini app không tạo được bảng. Nó khai báo trong `schema.json` ở gốc source
([format ở 03](03-du-lieu.md#khai-báo-schema--schemajson)); backend so khai báo
với workspace ở **mỗi lần cài và mỗi lần upload source**:

```
khai báo khớp sẵn      → schemaStatus "applied", build chạy như thường
khai báo thiếu thứ gì  → schemaStatus "pending", statusMessage
                         "Waiting for a review of schema.json",
                         KHÔNG có build nào được tạo
không có schema.json   → schemaStatus "none", y hệt trước đây
```

`POST /:id/deploy` trong lúc `pending` trả **409**:
`"This mini app declares objects the workspace does not have yet — review its
schema first"`. Poll build cũng vô nghĩa — chưa có build nào.

Hai endpoint của màn duyệt (cần RBAC `miniapp:manage` + item-ACL manage; app
`sourceType: "external"` gọi vào trả 409):

```
GET  /mini-apps/:id/schema        → { miniAppId, status, objects: [...] }
POST /mini-apps/:id/schema/apply  → MiniApp (schemaStatus "applied", đã xếp hàng build)
```

`GET /schema` **tính lại diff mỗi lần gọi** (workspace có thể vừa bị người khác
sửa) — mở màn duyệt là fetch lại, đừng cache. Mỗi bảng/field có `action`:

| action | Nghĩa |
| --- | --- |
| `create` | chưa có, sẽ được tạo |
| `update` | (cấp bảng) bảng đã có nhưng thiếu field |
| `unchanged` | đã có sẵn, không đụng tới |
| `conflict` | (cấp field) trùng tên nhưng khác type — kèm `currentType` |

`POST /schema/apply`:

- chỉ chạy khi `schemaStatus === "pending"`, ngược lại 409;
- chỉ **thêm** — không sửa, không xoá, không đổi type; bấm nhầm hai lần vô hại;
- tạo bằng quyền **người bấm** → cần `object:create` và/hoặc
  `object:field:create`, thiếu là 403 ([06](06-phan-quyen.md));
- còn `conflict` nào thì 409 trước khi tạo bất cứ thứ gì:
  `"The workspace already holds these fields with another type: Đơn nghỉ
  phép.Số ngày is text, the app declares number"`;
- thành công → build được xếp hàng, quay lại vòng poll bình thường.

Người viết app soi trước bằng SDK, không cần đợi tới lúc upload:

```js
// create / update / unchanged / conflict — đúng thứ màn duyệt sẽ hiện
console.log(await client.schemaPlan(schema));
```

## Vòng đời trạng thái

```
cài / deploy ──► pending ──► building ──► running
                                │            │ stop
                                ▼            ▼
                              failed      stopped ──start──► running
```

- Poll `GET /mini-apps/:id` mỗi ~5s tới khi `running`/`failed`. Build đầu
  của một stack có thể vài phút (kéo base image), các lần sau thường <1 phút.
- `failed`: `statusMessage` chứa output build/deploy — đọc là ra lỗi.
- `start`/`stop` **bất đồng bộ**: response trả ngay (`statusMessage: "start
  queued"`), worker làm rồi cập nhật status.
- `deploy` khi đang `building` → 409. `start`/`stop`/`logs` khi app chưa
  từng deploy thành công → 409.

## Vận hành

```
POST /mini-apps/:id/deploy        build + chạy lại từ source hiện tại (rotate API key)
POST /mini-apps/:id/start         chạy lại container đã stop
POST /mini-apps/:id/stop          dừng (không xoá)
PUT  /mini-apps/:id               sửa name/description/port/env/repoBranch (áp dụng lần deploy sau)
GET  /mini-apps/:id/logs?tail=200 log container (worker lấy hộ; 504 nếu worker im 10s)
GET  /mini-apps/:id/schema        diff giữa schema.json và workspace
POST /mini-apps/:id/schema/apply  tạo phần còn thiếu (quyền của người bấm) + build
DELETE /mini-apps/:id             gỡ app: xoá container + service account
                                  (bảng dữ liệu app khai báo KHÔNG bị xoá theo)
```

## Logo

Đặt `logo.webp` ở **root project** (cạnh package.json) và serve tại
`GET /logo.webp`:

```js
server.get("/logo.webp", (_req, res) => res.sendFile("logo.webp", { root: process.cwd() }));
```

Deploy phát hiện file → API expose `logoUrl = <app url>/logo.webp` (Traefik
proxy thẳng từ container). App stopped thì logo chết — UI app chủ tự
fallback.

## Chạy local khi phát triển

Không có ENV inject — tự cấp ([chi tiết ở 02](02-bat-dau.md#3-chạy-local)):

```bash
ERP_BASE_URL=http://localhost:8000 ERP_API_KEY=erp_sk_... PORT=4567 npm start
```

Giả lập user mở app: lấy initData bằng token user thật
(`POST /auth/miniapp/init-data` với `serviceAccountId` của SA dev) rồi mở
`http://localhost:4567/#erpInitData=<urlencoded>`.

## Lỗi thường gặp

| Triệu chứng | Nguyên nhân → cách xử |
| --- | --- |
| `failed` ngay sau cài, log có `MissingPermissionsError` | Key thiếu quyền app khai. Gắn IAM rule cấp đúng phần `.missing` cho service account rồi `POST /:id/deploy`. Nếu app khai `object:create`/`object:field:create` thì bỏ đi — mini app không bao giờ có quyền đó |
| Cài xong app đứng yên, không có build nào | `schemaStatus: "pending"` — đang chờ duyệt `schema.json`, xem mục "Duyệt schema.json" |
| `failed`, log có `SchemaMismatchError` | Workspace bị sửa sau khi duyệt (đổi tên/kiểu field). `.missing`/`.conflicts` của lỗi (hoặc `client.schemaPlan`) chỉ đúng chỗ lệch — sửa workspace hoặc ship `schema.json` mới |
| 400 ngay lúc upload zip, message nói về field/type | `schema.json` sai luật (type lạ, `formula`/`lookup`/`rollup`, trùng tên, thiếu `config.targetObject`). Hiện thẳng message đó — nó chỉ đúng chỗ sai |
| 403 khi bấm áp dụng schema | Người bấm thiếu `object:create` / `object:field:create` — nhờ admin cấp IAM rule hoặc nhờ admin bấm hộ |
| `failed`, statusMessage là output nixpacks | Build hỏng: thiếu script `start`, lockfile lệch, stack không nhận diện. Sửa source, ship lại |
| Build ok nhưng app không lên `running` | App không nghe đúng `PORT` hoặc bind `localhost` thay vì `0.0.0.0` |
| App lên nhưng FE gọi `api/...` ra 404 | Mở app thiếu `/` trước `#` → fetch tương đối resolve sai path Traefik. App chủ phải ghép `${url}/#erpInitData=...` |
| 401 từ `session()` | initData hết hạn (5 phút) hoặc của app khác → FE xin app chủ initData mới |
| 401/403 giữa chừng sau redeploy | App cache API key cũ (key đã rotate). Không tự lưu key ra ngoài `process.env` |
| 409 khi update/delete record | Version lệch (optimistic lock) — đọc lại record, thử lại |
| 409 khi cài | Tên app trùng slug trong workspace |
| 502 kèm output docker | Thao tác container lỗi — đọc message, thử lại; kiểm tra worker |
| `logs` trả 504 | Worker không phản hồi trong 10s — kiểm tra worker còn sống |

---

[← Phân quyền](06-phan-quyen.md) · [Mục lục](README.md) · [Tiếp: API reference →](08-api-reference.md)
