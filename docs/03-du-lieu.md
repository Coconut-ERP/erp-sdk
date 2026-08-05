# 03 — Làm việc với dữ liệu (object, field, record)

[← Bắt đầu](02-bat-dau.md) · [Mục lục](README.md) · [Tiếp: DataFrame →](04-dataframe.md)

Object engine của ERP là database của mini app: **object** = bảng, **field**
= cột, **record** = dòng. Tất cả scoped theo workspace của API key.

## Địa chỉ bằng display name

SDK load schema một lần và resolve **tên hiển thị hoặc key** giúp bạn — code
đọc như ngôn ngữ nghiệp vụ:

```ts
const invoices = await app.object("Hóa đơn bán hàng"); // theo tên, id, không phân biệt hoa thường
invoices.id;                 // object id
invoices.fields;             // FieldDto[]
invoices.field("Trạng thái"); // FieldDto — không có thì throw UnknownFieldError kèm danh sách field đúng
```

Tên sai throw `UnknownObjectError` / `UnknownFieldError` (có `.known` liệt kê
field hợp lệ) — lỗi chính tả lộ ra ngay, không âm thầm ghi sai cột.

Handle được cache theo cả tên lẫn id. Nếu schema bị đổi từ bên ngoài khi app
đang chạy, gọi `app.invalidate()` hoặc `app.objects(true)` để nạp lại.

## Khai báo schema — `schema.json`

Mini app **không tự tạo được bảng/field**. Service account của app là `member`
(hoặc `viewer`), gọi `POST /objects` là ăn `403`. Thay vào đó app *khai báo*
bảng nó cần trong file `schema.json` ở **gốc source** (gốc zip; nếu zip có một
thư mục gốc duy nhất thì là gốc thư mục đó):

```json
{
  "objects": [
    {
      "name": "Đơn xin nghỉ",
      "position": 0,
      "fields": [
        { "name": "Người xin nghỉ", "type": "single_select",
          "config": { "source": "workspace_users" }, "position": 0 },
        { "name": "Lý do",   "type": "long_text", "position": 1 },
        { "name": "Từ ngày", "type": "date", "position": 2 },
        { "name": "Trạng thái", "type": "single_select",
          "config": { "source": "static", "options": ["pending", "approved", "rejected"] } }
      ]
    }
  ]
}
```

Payload **kế thừa nguyên từ object API**: một phần tử `objects` = body của
`POST /objects` (`name`, `position`) cộng thêm `fields`; một phần tử `fields` =
body của `POST /objects/:id/fields` (`name`, `type`, `config`, `position`).

Lúc cài app (hoặc upload version mới), backend so khai báo với workspace. Khớp
sẵn thì deploy chạy luôn; thiếu thứ gì thì app dừng ở `schemaStatus: "pending"`
và **không có build nào được tạo** cho tới khi người deploy mở màn duyệt và bấm
áp dụng — backend tạo phần thiếu **bằng quyền của chính người bấm**. Chi tiết
luồng: [07 — Triển khai](07-trien-khai-van-hanh.md#duyệt-schemajson-khi-deploy).

### Kiểm tra lúc boot — `assertSchema`

```ts
import { readFileSync } from "node:fs";
const schema = JSON.parse(readFileSync(new URL("./schema.json", import.meta.url), "utf8"));

// Khớp: trả về handle theo đúng tên đã khai báo. Lệch: throw SchemaMismatchError
// nêu rõ thiếu bảng/field nào, kèm hướng dẫn nhờ người deploy duyệt schema.
const { "Đơn xin nghỉ": leaves } = await app.assertSchema(schema);
```

Sai một chỗ, hỏng một lần, ngay lúc boot — thay vì `UnknownFieldError` rơi rớt
ở từng route. Muốn xem diff mà không throw: `app.schemaPlan(schema)` trả đúng
cấu trúc mà màn duyệt dùng (`action`: `create` / `update` / `unchanged` /
`conflict`).

### Luật backend áp lúc upload zip

- Không khai báo được `formula` / `lookup` / `rollup`: config của chúng trỏ tới
  field khác bằng key nội bộ mà app không biết. Cần thì tạo tay trong workspace.
- `relation` dùng `config.targetObject` = **tên bảng** (app không biết id);
  target là bảng khai cùng file hoặc bảng đã có sẵn trong workspace.
- Tên bảng/field không trùng nhau (không phân biệt hoa thường), ≤ 255 ký tự;
  tối đa 50 bảng, 200 field/bảng; file ≤ 256KB; key lạ trong JSON bị từ chối.

Sai bất kỳ điểm nào → `400` ngay lúc upload. Bắt trước bằng CLI:

```bash
erp schema check                 # cú pháp + diff với workspace hiện tại
erp schema check --offline       # chỉ cú pháp, không cần credential
erp schema init --object "Nhân viên"   # xuất bảng đang có ra schema.json
```

### Đổi schema

Sửa `schema.json` → upload version mới (`PUT /mini-apps/:id/source`) → người
deploy duyệt lại. Chỉ **thêm** được: đổi kiểu field đã có là `conflict`, phải
sửa tay trong workspace (hoặc sửa khai báo) rồi duyệt lại; xoá bảng/field cũng
là việc làm tay trong workspace.

### Tự tạo schema bằng key admin (tooling, không phải app)

`createObject` / `ensureObject` / `addField` vẫn còn trong SDK cho script chạy
bằng key admin — ví dụ dựng sẵn workspace demo trước khi cài app:

```ts
const orders = await admin.ensureObject("Đơn đặt hàng", [{ name: "Số lượng", type: "number" }]);
await orders.updateField("Số lượng", { name: "SL" });   // đổi tên/config/position/isArchived
await orders.rename("Đơn hàng");
await admin.deleteObject("Đơn hàng");
```

Gọi chúng từ mini app lúc boot chỉ nhận `403` — đó là lý do `assertSchema` tồn
tại.

### 18 kiểu field

| Nhóm | Type |
| --- | --- |
| Chữ | `text`, `long_text`, `url`, `email`, `phone` |
| Số | `number`, `currency`, `percent` |
| Logic/thời gian | `checkbox`, `date`, `datetime` |
| Lựa chọn | `single_select`, `multi_select` — `config.source`: `"static"` (+ `options: [...]`) hoặc `"workspace_users"` (giá trị là user id) |
| Quan hệ | `relation` (link bảng khác), `lookup`, `rollup`, `formula` (computed) |
| File | `attachment` |

Giá trị field computed (`lookup`/`rollup`/`formula`) nằm ở `record.computedData`,
backend tính bất đồng bộ (`computeStatus`: `fresh`/`stale`/`computing`/`failed`).

## CRUD record

```ts
const created = await invoices.create({ "Trạng thái": "draft", "Tổng tiền": 500_000 });
const record  = await invoices.get(created.id);

await invoices.update(created.id, { "Trạng thái": "approved" });
// ↑ tự GET lấy version hiện tại (2 request). Truyền version để lock tường minh:
await invoices.update(created.id, { "Trạng thái": "approved" }, created.version);

await invoices.delete(created.id);           // soft delete (cũng nhận version)
await invoices.restore(created.id, version); // khôi phục
```

**Optimistic lock:** mọi update/delete cần đúng `version` hiện tại; lệch là
409 (`ErpApiError`) — bên khác đã sửa trước, đọc lại rồi thử lại. Dạng gọi
không truyền version tiện nhưng không an toàn tuyệt đối khi ghi đua.

Key trong `data` là tên hiển thị hoặc key field — SDK resolve, sai tên là
throw trước khi gọi mạng.

### Record trả về

```ts
interface RecordDto {
  id: string;
  data: Record<string, unknown>;          // key = field key nội bộ
  computedData: Record<string, unknown> | null;
  version: number;
  createdBy: string; updatedBy: string;   // user/service-account id
  createdAt: string; updatedAt: string;
  // computeStatus, computeError, ...
}
```

`data` dùng field key (`status`), không phải tên. Muốn object phẳng theo tên
hiển thị (kèm `id`, `version`, `createdAt`, `updatedAt`, đã merge computed):

```ts
invoices.rowFromRecord(record);           // { "Trạng thái": "approved", ... }
invoices.rowFromRecord(record, "key");    // theo key
```

## Query — filter, sort, phân trang phía server

`records()` mở query builder; `fetch()` gọi `POST /records/query`:

```ts
const page = await invoices
  .records()
  .where("Trạng thái", "equals", "approved")
  .where("Tổng tiền", "greater_than", 1_000_000)   // nhiều where = AND
  .orderBy("Tổng tiền", "desc")
  .limit(50)
  .withTotal()
  .fetch();
// { records, nextCursor, hasMore, total }

// Trang sau:
await invoices.records().cursor(page.nextCursor!).fetch();
```

Tiện ích:

```ts
const all = await q.fetchAll();              // tự lặp cursor đến hết (cẩn thận bảng lớn)
const all2 = await q.fetchAll({ max: 500 }); // chặn trần
const one = await invoices.records().where("Số hóa đơn", "equals", "INV-001").first();
const n   = await invoices.records().where("Trạng thái", "equals", "pending").count();
```

**Toán tử:** `equals`, `not_equals`, `contains` (chuỗi, không phân biệt hoa
thường), `greater_than`, `greater_than_or_equal`, `less_than`,
`less_than_or_equal`, `is_empty`, `is_not_empty`.

**Giới hạn server:** tối đa 20 filter, 3 sort, 100 record/trang. Cần lọc
phức tạp hơn (OR, lồng nhau) → kéo về rồi lọc bằng [DataFrame](04-dataframe.md).

Lưu ý quyền: kết quả đọc luôn bị thu hẹp thêm bởi row scope của actor
(service account hoặc user, tuỳ client nào đang gọi) — hai actor cùng câu
query có thể thấy hai tập dòng khác nhau.

## Link giữa các bảng (field `relation`)

```ts
await invoices.createLink(invoiceId, "Khách hàng", customerRecordId);
await invoices.listLinks(invoiceId, "Khách hàng");            // direction mặc định "outgoing"
await invoices.listLinks(invoiceId, "Khách hàng", "incoming");
await invoices.deleteLink(invoiceId, "Khách hàng", customerRecordId);
```

## Chọn quyền chạy: app hay user?

Mọi API trên chạy dưới actor của client đang gọi:

```ts
const leaves = await app.object("Đơn xin nghỉ");        // quyền service account
const { user, client } = await app.session(initData);
const mine = await client.object("Đơn xin nghỉ");       // quyền của chính user
```

Mặc định dùng quyền app và tự ghi `user.id` vào field định danh (mô hình app
authority — xem [01](01-tong-quan.md) và [05](05-danh-tinh-nguoi-dung.md)).

---

[← Bắt đầu](02-bat-dau.md) · [Mục lục](README.md) · [Tiếp: DataFrame →](04-dataframe.md)
