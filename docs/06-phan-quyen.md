# 06 — Phân quyền: service account, permission, IAM

[← Danh tính người dùng](05-danh-tinh-nguoi-dung.md) · [Mục lục](README.md) · [Tiếp: Triển khai →](07-trien-khai-van-hanh.md)

## Service account — app là một "user máy"

Khi cài mini app, ERP tạo một service account riêng: một user không đăng
nhập được bằng mật khẩu, là member của đúng một workspace với role do người
cài chọn (`admin`/`member`/`viewer`), xác thực bằng API key `erp_sk_…`
(header `X-API-Key`; SDK tự gắn). Key **xoay vòng mỗi lần deploy** — luôn
đọc từ `process.env.ERP_API_KEY`.

Quyền của app = quyền role của service account + các IAM rule gắn thêm cho
riêng nó. Record app tạo mang `createdBy` = service account id.

## Khai báo quyền lúc boot — fail fast

Liệt kê mọi quyền app cần trong `createMiniApp`; SDK gọi
`GET /iam/me/permissions` và đối chiếu ngay:

```ts
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
```

Thiếu quyền nào → throw `MissingPermissionsError` với `.missing` liệt kê
chính xác — deploy hỏng cấu hình chết ngay lúc boot (status `failed`, thấy
trong logs), không chết giữa luồng user. Khai đúng những gì dùng, đừng khai
`*`.

Tra cứu nhanh — thao tác nào cần quyền gì:

| Thao tác SDK | Permission |
| --- | --- |
| `app.objects()`, `app.object(name)` | `object: read` (+ `object:field: read` để load field) |
| `createObject`, `ensureObject` (tạo mới) | `object: create` |
| `rename`, `deleteObject` | `object: update` / `delete` |
| `addField`, `updateField` | `object:field: create` / `update` |
| `records().fetch/…`, `get` | `object:record: read` |
| `create` / `update` / `delete` / `restore` record | `object:record: create` / `update` / `delete` |
| links | `object:record: read`/`update` trên bảng nguồn |

## Kiểm tra quyền lúc chạy

```ts
await app.can("object:record", "delete");        // boolean, cache sẵn
await app.assertPermissions([{ resource: "workflow", action: "read" }]); // throw nếu thiếu
const perms = await app.myPermissions();          // PermissionDto[] hiệu lực
await app.myPermissions(true);                    // ép nạp lại (sau khi admin đổi rule)
```

Logic khớp đúng enforcer backend: **deny thắng allow**, `*` match mọi
resource/action, `manage` **không** bao hàm action khác. Đây là preflight
tiện cho UI (ẩn nút xoá nếu `can()` false) — **nguồn chân lý luôn là
server**: qua được RBAC vẫn còn row scope và item ACL phía sau.

## Bốn tầng enforcement phía server

1. **Membership** — service account/user phải là member active của workspace.
2. **RBAC** — `Enforce(actor, workspace, resource, action)`; các rule đến từ
   role + rule gắn trực tiếp. Sai → 403.
3. **Row scope** — riêng `object:record`: quyền đọc/ghi có thể kèm điều kiện
   dòng (ví dụ "chỉ record phòng ban X"). Hai actor cùng câu query thấy hai
   tập dòng khác nhau; một grant `scope: all` là hết giới hạn cho object đó.
4. **Item ACL** — từng item (mini app, dashboard, folder, workflow) có
   visibility riêng. Với mini app: `workspace` (mặc định — mọi member thấy
   và mở được) hoặc `restricted` (chỉ người tạo, người được grant, và
   owner/admin; người khác bị 404 kể cả khi xin initData).

## Chọn role lúc cài app & siết quyền

- App **tự provision schema** (`ensureObject`) → role `admin`, hoặc chuẩn
  hơn: `member` + IAM rule cấp `object`/`object:field` create riêng cho
  service account của app.
- App **chỉ đọc/ghi bảng có sẵn** → `member` là đủ (role member có CRUD
  object/record mặc định).
- Nguyên tắc: cấp tối thiểu. README của app nên liệt kê đúng danh sách
  `permissions` nó khai — người cài đọc được và quyết định.

Admin cấp thêm/thu hẹp quyền cho app qua IAM rules của ERP
(`POST /iam/rules` gắn subject = service account) — không cần redeploy;
app gọi `myPermissions(true)` hoặc cứ để cache tự hết theo lần boot sau.

## Khi user authority — quyền của ai?

Dùng `session(initData).client` hoặc `app.asUser(accessToken)` thì mọi tầng
trên áp lên **user thật**: RBAC theo role của họ, row scope của họ, item ACL
với họ. App không nới rộng được quyền user — chỉ kế thừa.

---

[← Danh tính người dùng](05-danh-tinh-nguoi-dung.md) · [Mục lục](README.md) · [Tiếp: Triển khai →](07-trien-khai-van-hanh.md)
