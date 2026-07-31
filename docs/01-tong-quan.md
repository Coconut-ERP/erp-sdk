# 01 — Tổng quan & kiến trúc

[← Mục lục](README.md) · [Tiếp: Bắt đầu →](02-bat-dau.md)

## Mini app là gì?

Một mini app là một **web app độc lập, nhỏ, cài theo từng workspace** của
ERP. Nó giống Telegram Mini App: người dùng mở app từ trong giao diện ERP
(iframe), app tự chạy trên hạ tầng của ERP, và dùng ERP làm "core engine" —
dữ liệu, phân quyền, danh tính người dùng đều lấy từ ERP thay vì tự xây.

Một mini app điển hình gồm hai nửa:

- **Server** (bắt buộc): giữ API key, gọi ERP qua SDK, serve static frontend.
- **Frontend** (tuỳ app): UI chạy trong iframe, nhận initData từ app chủ,
  gọi về server của chính app.

App viết bằng gì cũng được — nixpacks tự nhận diện stack (Node, Go, Python,
Rust…). SDK này phục vụ TypeScript/JavaScript; ngôn ngữ khác gọi thẳng REST
API với cùng các header.

## Vòng đời một mini app trên ERP

```
Admin cài app (POST /mini-apps: template / repo git / upload zip)
        │
        ▼
ERP tạo service account riêng cho app + API key erp_sk_…
        │
        ▼
Worker deploy:  clone/giải nén source ──► nixpacks build image
                ──► chạy container sau Traefik
                ──► inject ENV: ERP_BASE_URL, ERP_API_KEY, ERP_WORKSPACE_ID, PORT
        │
        ▼
App boot:  createMiniApp({ baseUrl, apiKey, permissions })
           → SDK kiểm tra key có đủ quyền đã khai báo, thiếu thì throw ngay
        │
        ▼
User mở app trong iframe, kèm initData ──► app.session(initData) → biết user là ai
```

Mỗi lần **redeploy, API key được xoay vòng** — app không bao giờ nên hardcode
key, luôn đọc từ `process.env.ERP_API_KEY`.

## Bốn khái niệm cốt lõi

### 1. Workspace — ranh giới tenant

Mọi dữ liệu (object, record, user membership) sống trong một workspace. API
key của mini app **gắn chặt với một workspace** — app không cần và không thể
tự chọn workspace khác; backend tự scope mọi request theo key.

### 2. Service account — danh tính của app

Lúc cài, ERP tạo một service account (một "user máy") riêng cho app, gắn
membership vào workspace với role admin/member/viewer do người cài chọn.
Record do app tạo mang `createdBy` = service account đó. API key `erp_sk_…`
chính là credential của service account này.

### 3. Object engine — database của app

Thay vì tự dựng Postgres, app dùng bảng của ERP: **object** (bảng) chứa
**field** (cột, 18 kiểu: text, number, date, single_select, relation…) chứa
**record** (dòng, có version để optimistic lock, soft delete + restore).
App có thể tự tạo bảng của riêng nó lúc boot (`ensureObject` — idempotent)
hoặc đọc/ghi bảng có sẵn của workspace. Chi tiết: [03 — Dữ liệu](03-du-lieu.md).

### 4. initData — danh tính của người dùng

App chủ không bao giờ đưa JWT của user cho mini app. Thay vào đó nó xin
backend một **chuỗi initData đã ký HMAC** (giống Telegram Web App) nêu rõ:
user nào, workspace nào, cho mini app nào. Mini app đổi chuỗi này lấy danh
tính user đã xác minh qua `app.session(initData)` — backend kiểm chữ ký, hạn
5 phút, và bắt buộc đúng API key của app đó mới đổi được. Chi tiết:
[05 — Danh tính người dùng](05-danh-tinh-nguoi-dung.md).

## Hai mô hình quyền — quyết định sớm

Khi user thao tác trong app, thao tác đó chạy dưới quyền của **ai**?

**App authority (mặc định, khuyến nghị — kiểu Telegram bot).** Mọi thao tác
dữ liệu chạy bằng client của app (service account). `session(initData)` chỉ
dùng để biết *ai* đang bấm — app tự ghi user id vào một field. Ai được phép
*mở* app (ACL của mini app) là dùng được trọn chức năng, kể cả khi role cá
nhân của họ không ghi được bảng đó. Ranh giới dữ liệu theo user (ví dụ "chỉ
thấy đơn của tôi") là **trách nhiệm của app** trong câu query.

**User authority (opt-in).** Dùng `client` trả về từ `session()` (hoặc
`app.asUser(token)`) — mọi call bị giới hạn đúng theo IAM permission + row
scope của user đó, `createdBy` là user thật. Chỉ chọn khi app phải phản chiếu
chính xác quyền dữ liệu từng người của ERP (ví dụ app duyệt dữ liệu tổng
quát); user thiếu quyền gốc sẽ ăn 403 ngay trong app.

Trộn được hai mô hình trong cùng một app: đọc bằng quyền user, ghi bằng quyền
app, tuỳ endpoint.

## Phân quyền nhiều tầng (nhìn từ phía app)

Request của app đi qua các tầng, tầng dưới chỉ thu hẹp tầng trên:

1. **Membership** — service account phải là member workspace (tự có lúc cài).
2. **RBAC** — hành động cần permission (`object:record` + `create`…). Key
   được cấp quyền theo role lúc cài + các IAM rule gắn thêm. SDK kiểm tra
   trước lúc boot qua `permissions: [...]`.
3. **Row scope** — riêng `object:record`, quyền đọc có thể bị thu hẹp theo
   điều kiện dòng (IAM scopes).
4. **Item ACL** — bảng điều khiển *ai được dùng app* (visibility
   `workspace`/`restricted`) nằm phía ERP, app không phải làm gì.

Chi tiết: [06 — Phân quyền](06-phan-quyen.md).

## SDK cung cấp gì?

| Nhóm | API chính |
| --- | --- |
| Khởi tạo | `createMiniApp(config)` → `ErpClient`; fail-fast nếu key thiếu quyền |
| Dữ liệu | `app.object(name)` → `ObjectHandle`: CRUD record, query builder, links, schema |
| Phân tích | `query.toFrame()` → `DataFrame` kiểu pandas |
| Danh tính | `app.session(initData)`, `app.issueInitData()` (phía app chủ), helpers browser: `readInitDataFromLocation`, `receiveInitData`, `parseInitData`, `sendInitDataToFrame` |
| Quyền | `app.can()`, `app.assertPermissions()`, `app.myPermissions()` |
| Lỗi | `ErpApiError`, `MissingPermissionsError`, `UnknownObjectError`, `UnknownFieldError` |

Tất cả chỉ là lớp mỏng trên REST API (`<ERP>/api/v1/...`, response bọc
envelope `{ success, message, statusCode, data }` — SDK tự bóc `data`).

---

[← Mục lục](README.md) · [Tiếp: Bắt đầu →](02-bat-dau.md)
