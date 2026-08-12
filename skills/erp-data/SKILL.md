---
name: erp-data
description: Đọc, ghi và phân tích dữ liệu trong workspace ERP 1kk bằng erp-sdk (TypeScript/JavaScript). Dùng khi task nhắc tới erp-sdk, createMiniApp, ErpClient, ObjectHandle, RecordQuery, DataFrame, ERP_API_KEY / erp_sk_, object–field–record của ERP, hoặc khi người dùng muốn lấy/thống kê/nhập/sửa dữ liệu trên ERP ("lấy danh sách đơn hàng từ ERP", "báo cáo doanh thu theo tháng", "import CSV vào bảng", "cập nhật hàng loạt", "join hai bảng", "xuất Excel/CSV từ ERP").
---

# Khai thác dữ liệu ERP bằng erp-sdk

ERP 1kk lưu dữ liệu trong **object engine**: object (bảng) → field (cột) → record
(dòng). `erp-sdk` là lớp TypeScript trên REST API đó: resolve tên hiển thị sang
key nội bộ, phân trang hộ, và có sẵn `DataFrame` kiểu pandas để tổng hợp.

**Cách làm việc mặc định: viết một script chạy được rồi chạy nó.** CLI `erp` chỉ
để dựng môi trường và xem schema thật — mọi thao tác đọc/ghi/phân tích đều viết
bằng SDK, vì logic nhiều bước (join, tổng hợp, kiểm tra trước khi ghi) không
diễn đạt được bằng cờ dòng lệnh.

## 1. Kết nối

```bash
npm install https://github.com/Coconut-ERP/erp-sdk/releases/download/v0.3.0/erp-sdk.tgz
```

Cần hai biến môi trường (Node 18+, `.env` **không bao giờ** commit):

```
ERP_BASE_URL=https://erp.example.com
ERP_API_KEY=erp_sk_...
```

```bash
npx erp doctor        # env + kết nối + quyền → {ok, checks[]}, exit 1 nếu hỏng
```

Chưa có credential thì **dừng lại hỏi người dùng** — đừng đoán URL/key, cũng
đừng đoán tên bảng.

```ts
import { createMiniApp } from "erp-sdk";

const erp = await createMiniApp({
  baseUrl: process.env.ERP_BASE_URL!,
  apiKey: process.env.ERP_API_KEY!,
  permissions: [                       // preflight: thiếu quyền là chết ngay đây
    { resource: "object", action: "read" },
    { resource: "object:field", action: "read" },
    { resource: "object:record", action: "read" },
  ],
});
```

Chạy script: `node --env-file=.env script.mjs` (Node 20.6+), hoặc
`npx tsx script.ts` cho TypeScript. Đặt script trong thư mục làm việc tạm, đừng
rải vào source của người dùng trừ khi họ yêu cầu.

## 2. Xem schema thật trước khi viết code

**Tên object/field là địa chỉ dữ liệu.** Đoán sai → `UnknownObjectError` /
`UnknownFieldError` lúc chạy. Luôn lấy schema thật trước:

```bash
npx erp objects list                      # có bảng nào
npx erp objects show "Đơn hàng"           # field nào, type gì, config ra sao
npx erp schema dump --out workspace.json  # toàn bộ, nạp làm context
```

Hoặc trong chính script:

```ts
for (const meta of await erp.objects()) {
  const handle = await erp.object(meta.id);
  console.log(meta.name, handle.fields.map((f) => `${f.name}:${f.type}`));
}
```

Đọc kỹ `type` và `config` — `relation` trỏ bảng nào, `single_select` có
`options` gì, `source: "workspace_users"` nghĩa là giá trị lưu **user id**.

## 3. Đọc dữ liệu

```ts
const orders = await erp.object("Đơn hàng");   // theo tên hiển thị hoặc id

const page = await orders.records()
  .where("Trạng thái", "equals", "paid")
  .where("Ngày đặt", "greater_than_or_equal", "2026-01-01")
  .orderBy("Tổng tiền", "desc")
  .limit(50)
  .withTotal()
  .fetch();          // { records, nextCursor, hasMore, total }

const all = await orders.records().where("Trạng thái", "equals", "paid")
  .fetchAll({ max: 5000 });                    // tự đi hết cursor
const one = await orders.records().where("Mã đơn", "equals", "DH-001").first();
const n   = await orders.records().where("Trạng thái", "equals", "new").count();
```

Toán tử: `equals`, `not_equals`, `contains`, `in`, `not_in`, `greater_than`,
`greater_than_or_equal`, `less_than`, `less_than_or_equal`, `is_empty`,
`is_not_empty`.

Giới hạn server: **20 filter, 3 sort, 100 record/trang**, `in`/`not_in` tối đa
**200 giá trị**. Lọc theo id của chính record: `.whereIds([...])` (hoặc
`.where("id", "in", [...])`).

Mỗi `RecordDto` có `data` (key nội bộ), `computedData` (formula/lookup/rollup),
`version`, `createdBy`, `createdAt`… Đổi sang dòng phẳng cột theo **tên hiển
thị**: `orders.rowFromRecord(record)`.

**Bẫy hay gặp**

- `RecordQuery` là builder **có trạng thái**: `count()` và `first()` set
  `limit` lên chính nó. Mỗi lần query dựng một chain mới, đừng dùng lại object cũ.
- `fetchAll()` không giới hạn mặc định — luôn cân nhắc `{ max }` với bảng lớn.
- Row scope của IAM cắt bớt dữ liệu **im lặng**: đọc ra 0 dòng dù bảng có dữ
  liệu thường là quyền, không phải filter sai. Kiểm bằng `npx erp whoami`.
- `computedData` do worker tính nền, `computeStatus` có thể chưa `done` ngay sau
  khi ghi.

## 4. Quan hệ giữa các bảng — đừng N+1

Field `relation` trả về trong `data` dưới dạng **mảng id**. Ba cách lấy dữ liệu
liên quan, theo thứ tự nên dùng:

```ts
// 1. preload — server nạp kèm, tối đa 10 preload/query
const rows = await orders.records().preload("Khách hàng", { limit: 5 }).fetchAll();
const customersOf = (r) => orders.related(r, "Khách hàng");   // → RecordDto[]

// 2. getMany — một request/200 id, giữ nguyên thứ tự
const ids = rows.flatMap((r) => (r.data.customer as string[]) ?? []);
const customers = await (await erp.object("Khách hàng")).getMany(ids);

// 3. leftJoin trên DataFrame khi đã có sẵn cả hai bảng ở client
```

Tuyệt đối không gọi `handle.get(id)` trong vòng lặp theo dòng.

## 5. Phân tích: DataFrame

`toFrame()` = `fetchAll()` + đổi sang dòng phẳng (cột = tên hiển thị). Frame
**bất biến**, mọi method trả frame mới.

```ts
const df = await orders.records()
  .where("Ngày đặt", "greater_than_or_equal", "2026-01-01")
  .toFrame({ max: 20000 });

df.groupBy("Khách hàng")
  .agg({ doanhThu: ["sum", "Tổng tiền"], soDon: ["count"] })
  .sortBy("doanhThu", "desc")
  .head(10)
  .toArray();

// gộp theo tháng bằng key hàm
df.groupBy((r) => String(r["Ngày đặt"]).slice(0, 7), { as: "thang" })
  .sum("Tổng tiền", "doanhThu")
  .sortBy("thang")
  .toArray();

// join hai bảng đã tải về
const customers = await (await erp.object("Khách hàng")).records().toFrame();
df.leftJoin(customers.rename({ id: "customerId", "Tên": "Tên khách" }), "customerId");
```

Có sẵn: `filter/where`, `map`, `select`, `rename`, `sortBy`, `unique/uniqueBy`,
`pluck`, `head/tail/slice`, `sum/avg/min/max/count`, `countBy`, `keyBy`,
`groupBy().agg()/count()/sum()/avg()`, `leftJoin`, `toArray`.

Xuất kết quả: `JSON.stringify(df.toArray())`, hoặc tự nối CSV từ `toArray()`.
Số liệu báo cáo thì **in ra bảng gọn**, đừng đổ hàng nghìn dòng ra stdout.

## 6. Ghi dữ liệu

```ts
const rec = await orders.create({ "Mã đơn": "DH-001", "Tổng tiền": 500000 });

await orders.createMany(rows, { chunkSize: 500 });  // 1 transaction/lô, all-or-nothing

await orders.update(rec.id, { "Trạng thái": "paid" });        // tự đọc version
await orders.update(rec.id, { "Trạng thái": "paid" }, rec.version); // optimistic lock

const res = await orders.records()                  // bulk update theo filter
  .where("Trạng thái", "equals", "new")
  .update({ "Trạng thái": "processing" }, { limit: 1000 });
// → { matched, updated, hasMore } — còn hasMore thì gọi tiếp

await orders.delete(rec.id);                        // soft delete
await orders.restore(rec.id, version);
```

**Quy tắc trước khi ghi hàng loạt** (dữ liệu thật của người dùng, không undo được
bằng Ctrl-Z):

1. Chạy đúng filter đó với `.count()` trước, báo con số cho người dùng.
2. Với thao tác lớn hoặc phá hủy (bulk update, xóa, đổi trạng thái hàng loạt):
   **hỏi xác nhận** rồi mới chạy.
3. Bulk update ≤ 5 000 dòng/lần và trả `hasMore`; insert SDK tự chia lô 500.
   Field `unique` không set được bằng bulk update; computed field để worker tính.
4. Import từ file: kiểm tra vài dòng đầu, in thử payload đã map, rồi mới chạy hết.

## 7. Quyền và ranh giới

- Key `erp_sk_…` là **service account**, thường ở mức `member`: đọc/ghi record
  được, **tạo bảng/field thì không** (403). Muốn tạo bảng phải dùng key admin
  (`erp.createObject` / `ensureObject` / `handle.addField`) — mặc định đừng tự
  làm, hỏi người dùng trước vì đó là đổi cấu trúc workspace.
- `erp.can(resource, action)` là preflight nhanh; server vẫn là nguồn sự thật,
  deny thắng allow, `manage` không suy ra hành động khác.
- Cần chạy theo quyền của một user cụ thể: `erp.asUser(accessToken)` hoặc
  `(await erp.session(initData)).client`.
- **API key chỉ ở server.** Không log, không commit, không ship xuống browser,
  không viết vào file kết quả.

## 8. Lỗi nói thẳng cần sửa gì

| Lỗi | Trường hữu ích | Việc cần làm |
| --- | --- | --- |
| `UnknownObjectError` | `.object` | `npx erp objects list` — sai tên bảng |
| `UnknownFieldError` | `.field`, `.known` | `.known` liệt kê đúng field hợp lệ |
| `FilterValueError` | `.field`, `.operator` | `in`/`not_in` cần mảng 1..200 giá trị |
| `MissingPermissionsError` | `.missing` | cấp IAM rule đúng cặp `resource:action` |
| `SchemaMismatchError` | `.missing`, `.conflicts` | workspace chưa có bảng/field như khai báo |
| `ErpApiError` | `.status`, `.trace`, `.details` | 401/403 → key hoặc quyền; 409 → version cũ, đọc lại rồi update |

Đọc ra 0 record dù chắc chắn có dữ liệu → row scope, không phải filter.

## 9. CLI `erp` có gì

Chỉ những lệnh phục vụ việc dùng SDK — không có lệnh CRUD dữ liệu:

| Lệnh | Dùng khi |
| --- | --- |
| `erp doctor [--require resource:action]` | kiểm env, kết nối, quyền |
| `erp whoami` | key này là ai, có quyền gì |
| `erp objects list [--fields]` | có bảng nào |
| `erp objects show "<Bảng>"` | field, type, config của một bảng |
| `erp schema dump [--out file]` | toàn bộ schema làm context |
| `erp init [dir]` | scaffold một mini app chạy được |
| `erp skill install` · `erp skill path` | cài/định vị chính skill này |

Kết quả là **JSON ở stdout**, ghi chú và lỗi ở stderr; exit 0 ok, 1 lỗi chạy,
2 lỗi cú pháp. `erp help --json` trả toàn bộ command surface.

## Tham chiếu

- `references/api.md` — toàn bộ export của SDK: chữ ký, kiểu, giới hạn.
- `references/recipes.md` — script mẫu chạy được: báo cáo, join, import CSV,
  đồng bộ, dọn dữ liệu.
- Dựng **mini app** (web app dùng ERP làm backend, `schema.json`, initData) là
  chủ đề khác — xem `docs/README.md` trong repo erp-sdk.
