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

## Tự tạo schema — `ensureObject` (idempotent)

Pattern chuẩn cho app có bảng riêng: khai schema ngay lúc boot, chạy bao
nhiêu lần cũng được — có rồi thì thôi, thiếu field nào thêm field đó:

```ts
const leaves = await app.ensureObject("Đơn xin nghỉ", [
  { name: "Người xin nghỉ", type: "single_select", config: { source: "workspace_users" } },
  { name: "Lý do", type: "long_text" },
  { name: "Từ ngày", type: "date" },
  { name: "Đến ngày", type: "date" },
  { name: "Trạng thái", type: "single_select",
    config: { source: "static", options: ["pending", "approved", "rejected"] } },
]);
```

Cần quyền `object` + `object:field` (read, create) — xem [06](06-phan-quyen.md).
Quản lý schema chi tiết hơn:

```ts
const orders = await app.createObject("Đơn đặt hàng");
await orders.addField("Số lượng", "number");
await orders.updateField("Số lượng", { name: "SL" });   // đổi tên/config/position/isArchived
await orders.rename("Đơn hàng");
await app.deleteObject("Đơn hàng");
```

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
