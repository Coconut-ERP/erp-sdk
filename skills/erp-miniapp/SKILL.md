---
name: erp-miniapp
description: Build, debug and deploy mini apps on the 1kk ERP backend with erp-sdk and the `erp` CLI. Use whenever the task mentions erp-sdk, createMiniApp, ensureObject, initData, mini app, ERP object/field/record, ERP_API_KEY / erp_sk_ keys, or asks to read or write data in an ERP workspace ("viết mini app", "tạo bảng trên ERP", "đọc/ghi record", "phân quyền service account").
---

# Mini app trên nền ERP (erp-sdk)

Mini app = một web app bình thường (Express/Fastify/Next…) dùng ERP làm engine:
dữ liệu nằm trong **object engine** của workspace, không cần database riêng. App
xác thực bằng **API key của service account** (`erp_sk_…`) và biết *ai* đang thao
tác qua **initData** kiểu Telegram Mini App.

## Làm gì trước tiên

**Luôn xem schema thật trước khi viết code.** Tên object/field là địa chỉ dữ
liệu — đoán sai thì `UnknownFieldError` lúc chạy.

```bash
erp doctor                        # env + kết nối + quyền, trả JSON {ok, checks[]}
erp objects list                  # có những bảng nào
erp objects show "Đơn xin nghỉ"   # field nào, type gì, config ra sao
erp schema dump --out schema.json # toàn bộ workspace, nạp làm context
```

Nếu chưa có credentials: cần `ERP_BASE_URL` + `ERP_API_KEY` (hoặc `--env-file .env`).
Không có key thì **đừng đoán schema** — hỏi người dùng hoặc dùng `ensureObject`
để app tự tạo bảng của chính nó.

CLI luôn in **JSON ra stdout**, ghi chú và lỗi ra stderr → parse thoải mái.
`erp help --json` trả toàn bộ command surface dạng máy đọc được.

## Khung một mini app

```ts
import { createMiniApp } from "erp-sdk";

const app = await createMiniApp({
  baseUrl: process.env.ERP_BASE_URL!,
  apiKey: process.env.ERP_API_KEY!,     // nền tảng inject lúc deploy, xoay vòng mỗi lần
  permissions: [                         // khai báo đúng những gì app dùng
    { resource: "object", action: "read" },
    { resource: "object:field", action: "read" },
    { resource: "object:record", action: "read" },
    { resource: "object:record", action: "create" },
  ],
});
```

`createMiniApp` kiểm tra key với `/iam/me/permissions` ngay lúc boot → thiếu
quyền thì ném `MissingPermissionsError` liệt kê chính xác cần cấp gì. Deploy sai
cấu hình chết ngay lúc khởi động, không chết giữa luồng người dùng.

Tự dựng schema (idempotent, chạy lại nhiều lần vẫn an toàn):

```ts
const leaves = await app.ensureObject("Đơn xin nghỉ", [
  { name: "Người xin nghỉ", type: "single_select", config: { source: "workspace_users" } },
  { name: "Lý do", type: "long_text" },
  { name: "Từ ngày", type: "date" },
  { name: "Trạng thái", type: "single_select",
    config: { source: "static", options: ["pending", "approved", "rejected"] } },
]);
```

Đọc/ghi (object và field địa chỉ bằng **display name** hoặc key — SDK tự resolve):

```ts
const page = await leaves.records()
  .where("Trạng thái", "equals", "pending")
  .orderBy("Từ ngày", "desc")
  .limit(50).withTotal().fetch();       // { records, nextCursor, hasMore, total }

const all = await leaves.records().fetchAll();          // tự phân trang
const created = await leaves.create({ "Lý do": "Việc gia đình" });
await leaves.update(created.id, { "Trạng thái": "approved" });   // optimistic lock
```

Toán tử filter: `equals`, `not_equals`, `contains`, `greater_than`,
`greater_than_or_equal`, `less_than`, `less_than_or_equal`, `is_empty`,
`is_not_empty`. Giới hạn server: 20 filter, 3 sort, 100 record/trang.

## Danh tính người dùng (initData)

```ts
// App chủ (đang là user đăng nhập) xin chuỗi đã ký cho mini app:
const { initData } = await hostClient.issueInitData(miniAppServiceAccountId);
sendInitDataToFrame(iframe.contentWindow!, initData, "https://miniapp.example.com");

// Mini app FE: đọc từ URL fragment hoặc postMessage, gửi kèm mỗi request
// (thường là header X-Init-Data). parseInitData() CHỈ để hiển thị, không tin được.

// Mini app BE: đổi lấy danh tính đã xác minh
const { user } = await app.session(initData);
await leaves.create({ "Người xin nghỉ": user.id, ... });
```

**Hai mô hình quyền — chọn đúng ngay từ đầu:**

- **App authority (mặc định, nên dùng)** — mọi thao tác dữ liệu chạy bằng service
  account của app (`app`), `session()` chỉ để biết chắc user là ai và ghi id đó
  vào field. Ai được phép *mở* app thì dùng được đầy đủ chức năng, kể cả khi role
  cá nhân của họ không có quyền ghi object. Giới hạn "chỉ đơn của tôi" là việc
  của app: tự thêm `.where("Người tạo", "equals", user.id)`.
- **User authority (opt-in)** — dùng `session(initData).client` (hoặc `asUser`)
  để mọi call bị giới hạn theo quyền + row scope của chính user, `createdBy` là
  user thật. Chỉ chọn khi app phải soi đúng quyền per-user (data browser); user
  thiếu quyền sẽ ăn 403 ngay trong app.

initData sống 5 phút, session ~15 phút, không có refresh token — hết hạn thì xin
lại từ app chủ. Chuỗi này chỉ đổi được bởi đúng mini app mà nó chỉ định (endpoint
đổi session đòi API key của app đó), nên lộ ra ngoài cũng vô dụng.

## Quy tắc phải giữ

- **API key chỉ ở server.** Không bao giờ ship `erp_sk_…` xuống browser, không
  commit vào repo, không log ra. FE nói chuyện với BE của mini app, BE nói chuyện
  với ERP.
- **`allowedOrigins` phải tường minh** với `receiveInitData`, và origin cụ thể
  với `sendInitDataToFrame` — `"*"` bị SDK từ chối.
- **Khai báo permission tối thiểu** đúng những gì app dùng. Muốn app tự tạo bảng
  thì cần thêm `object:create` + `object:field:create`.
- **Không cache initData thay cho session**: cache theo `expiresIn` như ví dụ,
  đừng giữ vĩnh viễn.
- Server luôn là nguồn sự thật: `app.can()` chỉ là preflight nhanh, IAM row scope
  vẫn cắt bớt dữ liệu đọc được.

## Tạo app mới

```bash
erp init my-app --name "Đơn xin nghỉ" --object "Đơn xin nghỉ"
cd my-app && npm install && npm start
```

Sinh sẵn Express + `ensureObject` + bridge initData + trang HTML mẫu chạy được
ngay. Deploy: zip thư mục (bỏ `node_modules`) rồi upload qua module Mini App;
nền tảng build bằng nixpacks và inject `ERP_BASE_URL`, `ERP_API_KEY`,
`ERP_WORKSPACE_ID`, `PORT`.

## Debug nhanh

| Triệu chứng | Việc cần làm |
| --- | --- |
| `MissingPermissionsError` lúc boot | `erp doctor --require object:record:create` rồi cấp IAM rule đúng cặp resource:action |
| `UnknownFieldError` | `erp objects show "<Object>"` — lỗi đã kèm danh sách field hợp lệ |
| `UnknownObjectError` | `erp objects list`; hoặc dùng `ensureObject` để app tự tạo |
| 401 khi đổi initData | initData quá 5 phút, hoặc phát cho service account khác, hoặc user đã rời workspace |
| Đọc ra 0 record dù có dữ liệu | IAM row scope đang cắt; kiểm tra `erp perms list` |
| 403 giữa luồng ở chế độ user authority | Đó là quyền của user, không phải của app — cân nhắc đổi sang app authority |

## Tham chiếu

- `references/cli.md` — toàn bộ lệnh `erp`, cú pháp filter/set, ví dụ.
- `references/api.md` — bề mặt SDK: client, ObjectHandle, RecordQuery, DataFrame, error.
- Tài liệu tiếng Việt đầy đủ trong repo erp-sdk: `docs/README.md` (01→09), và
  app mẫu chạy thật `examples/miniapp-leave-request`.
