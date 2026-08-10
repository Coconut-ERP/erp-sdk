---
name: erp-miniapp
description: Build, debug and deploy mini apps on the 1kk ERP backend with erp-sdk and the `erp` CLI. Use whenever the task mentions erp-sdk, createMiniApp, assertSchema, schema.json, initData, mini app, ERP object/field/record, ERP_API_KEY / erp_sk_ keys, or asks to read or write data in an ERP workspace ("viết mini app", "khai báo bảng trên ERP", "đọc/ghi record", "phân quyền service account").
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
erp schema dump --out workspace.json # toàn bộ workspace, nạp làm context
erp schema check                  # khai báo schema.json của app có hợp lệ / khớp workspace không
```

Nếu chưa có credentials: cần `ERP_BASE_URL` + `ERP_API_KEY` (hoặc `--env-file .env`).
Không có key thì **đừng đoán schema** — hỏi người dùng, hoặc viết `schema.json`
rồi `erp schema check --offline` để ít nhất chắc cú pháp đúng.

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

## Bảng app cần: khai báo, không tự tạo

Service account của mini app là `member` — gọi `POST /objects` chỉ nhận `403`.
App khai bảng nó cần trong `schema.json` ở **gốc source**; người deploy xem bảng
so sánh (khai báo ⟷ workspace) rồi bấm áp dụng, backend tạo phần thiếu **bằng
quyền của người bấm**, sau đó mới build.

```json
{
  "objects": [
    { "name": "Đơn xin nghỉ", "position": 0, "fields": [
      { "name": "Người xin nghỉ", "type": "single_select",
        "config": { "source": "workspace_users" }, "position": 0 },
      { "name": "Lý do", "type": "long_text", "position": 1 },
      { "name": "Trạng thái", "type": "single_select",
        "config": { "source": "static", "options": ["pending", "approved"] }, "position": 2 }
    ]}
  ]
}
```

- Một phần tử `objects` = body `POST /objects` + `fields`; một phần tử `fields` =
  body `POST /objects/:id/fields`.
- `relation` trỏ target bằng **tên bảng**: `config.targetObject` (app không biết id).
- **Không khai báo được** `formula` / `lookup` / `rollup` — tạo tay trong workspace.
- Tên không trùng (không phân biệt hoa thường), ≤255 ký tự; ≤50 bảng, ≤200
  field/bảng, file ≤256KB; key lạ trong JSON bị từ chối. Sai → `400` lúc upload zip.

Lúc boot app chỉ *kiểm tra*:

```ts
import { readFileSync } from "node:fs";
const schema = JSON.parse(readFileSync(new URL("./schema.json", import.meta.url), "utf8"));

// khớp → handle theo tên bảng; lệch → SchemaMismatchError (.missing, .conflicts)
const { "Đơn xin nghỉ": leaves } = await app.assertSchema(schema);
```

Kiểm trước khi zip: `erp schema check` (cú pháp + diff, exit 1 nếu có vấn đề),
`erp schema init --object "..."` để xuất bảng đang có ra khai báo.

Sau khi cài/upload source, đọc `schemaStatus` của app: `"pending"` = đang chờ
duyệt, **chưa có build nào** (poll vô ích); `"applied"`/`"none"` = build bình
thường. Duyệt: `GET /mini-apps/:id/schema` → `POST /mini-apps/:id/schema/apply`
(người bấm cần `object:create` / `object:field:create`).

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

Toán tử filter: `equals`, `not_equals`, `contains`, `in`, `not_in`,
`greater_than`, `greater_than_or_equal`, `less_than`, `less_than_or_equal`,
`is_empty`, `is_not_empty`. Giới hạn server: 20 filter, 3 sort, 100 record/trang.

`in`/`not_in` nhận mảng tối đa 200 giá trị; `"id"` lọc theo id của chính record
(chỉ `equals`/`not_equals`/`in`/`not_in`). Field relation về sẵn trong `data`
dưới dạng mảng id, nên lấy bản ghi liên quan bằng **một** request thay vì mỗi
dòng một request:

```ts
await leaves.records().whereIn("Trạng thái", ["pending", "approved"]).fetchAll();

const ids = rows.flatMap((r) => (r.data.nhanVien as string[]) ?? []);
const staff = await employees.getMany(ids);   // tự chia lô 200, giữ thứ tự
```

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
- **Khai báo permission tối thiểu** đúng những gì app dùng. **Đừng khai**
  `object:create` / `object:field:create` trong mini app — key không bao giờ có,
  `createMiniApp` sẽ throw ngay lúc boot. Bảng thì khai trong `schema.json`.
- **Không cache initData thay cho session**: cache theo `expiresIn` như ví dụ,
  đừng giữ vĩnh viễn.
- Server luôn là nguồn sự thật: `app.can()` chỉ là preflight nhanh, IAM row scope
  vẫn cắt bớt dữ liệu đọc được.

## Tạo app mới

```bash
erp init my-app --name "Đơn xin nghỉ" --object "Đơn xin nghỉ"
cd my-app && npm install && npm start
```

Sinh sẵn `schema.json` + Express (`assertSchema`) + bridge initData + trang HTML
mẫu chạy được ngay. Deploy: zip thư mục (bỏ `node_modules`, **giữ
`schema.json`**) rồi upload qua module Mini App với `role=member`; nền tảng build
bằng nixpacks và inject `ERP_BASE_URL`, `ERP_API_KEY`, `ERP_WORKSPACE_ID`,
`PORT`.

## Debug nhanh

| Triệu chứng | Việc cần làm |
| --- | --- |
| `MissingPermissionsError` lúc boot | `erp doctor --require object:record:create` rồi cấp IAM rule đúng cặp resource:action |
| `UnknownFieldError` | `erp objects show "<Object>"` — lỗi đã kèm danh sách field hợp lệ |
| `UnknownObjectError` | `erp objects list`; nếu là bảng của app thì khai trong `schema.json` và nhờ người deploy duyệt |
| `SchemaMismatchError` lúc boot | `erp schema check` xem lệch chỗ nào; thiếu bảng/field → duyệt lại schema, `conflict` → sửa type trong workspace hoặc sửa khai báo |
| Cài app xong không thấy build | `schemaStatus: "pending"` — phải duyệt `schema.json` trước |
| `403` khi bấm áp dụng schema | Người bấm thiếu `object:create` / `object:field:create` |
| 401 khi đổi initData | initData quá 5 phút, hoặc phát cho service account khác, hoặc user đã rời workspace |
| Đọc ra 0 record dù có dữ liệu | IAM row scope đang cắt; kiểm tra `erp perms list` |
| 403 giữa luồng ở chế độ user authority | Đó là quyền của user, không phải của app — cân nhắc đổi sang app authority |

## Tham chiếu

- `references/cli.md` — toàn bộ lệnh `erp`, cú pháp filter/set, ví dụ.
- `references/api.md` — bề mặt SDK: client, ObjectHandle, RecordQuery, DataFrame, error.
- Tài liệu tiếng Việt đầy đủ trong repo erp-sdk: `docs/README.md` (01→10) —
  `schema.json` ở [03](docs/03-du-lieu.md), luồng duyệt ở
  [07](docs/07-trien-khai-van-hanh.md) — và app mẫu chạy thật
  `examples/miniapp-leave-request`.
