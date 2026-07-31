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

Cài xong ERP **tự deploy lần đầu** — không cần gọi `/deploy` thêm.

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
DELETE /mini-apps/:id             gỡ app: xoá container + service account
                                  (bảng dữ liệu app đã tạo KHÔNG bị xoá theo)
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
| `failed` ngay sau cài, log có `MissingPermissionsError` | Key thiếu quyền app khai. Cài lại `role: "admin"` hoặc gắn IAM rule cấp đúng phần `.missing`, rồi `POST /:id/deploy` |
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
