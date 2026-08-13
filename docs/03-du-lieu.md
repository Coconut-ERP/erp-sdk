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

Sai bất kỳ điểm nào → `400` ngay lúc upload. Bắt trước bằng chính SDK — cùng bộ
luật với backend, thuần hàm nên không cần credential:

```js
import { readFileSync } from "node:fs";
import { validateSchema, planSchema, schemaConflicts } from "erp-sdk";

const schema = JSON.parse(readFileSync("schema.json", "utf8"));
validateSchema(schema);              // string[] mọi lỗi backend sẽ bắt; [] = hợp lệ

// diff với workspace thật: `erp schema dump --out workspace.json` rồi
const workspace = JSON.parse(readFileSync("workspace.json", "utf8")).objects;
schemaConflicts(planSchema(schema, workspace));   // [] = không xung đột kiểu
```

Có client sẵn thì `client.schemaPlan(schema)` làm luôn cả hai bước.

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
thường), `in`, `not_in`, `greater_than`, `greater_than_or_equal`, `less_than`,
`less_than_or_equal`, `is_empty`, `is_not_empty`.

### `in` / `not_in` — khớp một tập giá trị

Nhận mảng, tối đa **200 giá trị**; đây là dạng tổng quát của filter trước kia
phải gọi một request cho mỗi giá trị:

```ts
await invoices.records().whereIn("Trạng thái", ["approved", "paid"]).fetchAll();
await invoices.records().whereNotIn("Trạng thái", ["draft"]).fetchAll();

// dạng đầy đủ, giống hệt:
await invoices.records().where("Trạng thái", "in", ["approved", "paid"]).fetch();
```

Mảng rỗng, không phải mảng, hoặc quá 200 phần tử → SDK ném `FilterValueError`
ngay tại chỗ, không tốn round trip. `not_in` giữ lại cả dòng chưa từng có giá
trị ở field đó (NULL không nằm trong tập bị loại). Multi-select không dùng
`in` — dùng `contains`.

### Lọc theo `id` của record

`"id"` là filter target duy nhất không phải field, nên chỉ nhận `equals`,
`not_equals`, `in`, `not_in`:

```ts
await invoices.records().whereIds([id1, id2, id3]).fetch();      // tối đa 200 id
await invoices.records().where("id", "not_equals", id1).fetch();
```

Nó ăn khớp với relation: field relation của chính object được trả sẵn trong
`data` dưới dạng **mảng id record liên quan** (không cần `preload`), nên màn
danh sách đọc id rồi lấy bản ghi bằng **một** request thay vì mỗi dòng một
request:

```ts
const lines = await invoiceLines.records().fetchAll();
const customerIds = lines.flatMap((l) => (l.data.customer as string[]) ?? []);

const customers = await customersTable.getMany(customerIds);
```

`getMany` khử trùng lặp, tự chia lô 200 id, và trả về **đúng thứ tự đã hỏi**.
Id mà row scope của actor không cho đọc (hoặc đã xoá mềm) thì vắng mặt — kết
quả ngắn hơn đầu vào là chuyện bình thường, không phải lỗi. Query có filter id
cũng **bỏ COUNT** trừ khi gọi `withTotal()`: đếm lại đúng những dòng đang đọc,
cho một con số chính người gọi vừa gửi lên, là quét thừa một lần.

Nếu một object lỡ có field tên là "id", field đó thắng — đúng thứ tự phân giải
của backend; muốn chắc chắn nói về id record thì dùng `whereIds()`.

**Giới hạn server:** tối đa 20 filter, 3 sort, 100 record/trang. Cần lọc
phức tạp hơn (OR, lồng nhau) → kéo về rồi lọc bằng [DataFrame](04-dataframe.md).

Lưu ý quyền: kết quả đọc luôn bị thu hẹp thêm bởi row scope của actor
(service account hoặc user, tuỳ client nào đang gọi) — hai actor cùng câu
query có thể thấy hai tập dòng khác nhau.

## Ghi hàng loạt — `createMany` và `.update()`

Ba API dưới đây tồn tại để một app đụng tới hàng nghìn dòng không biến mỗi
dòng thành một request HTTP và một transaction riêng. Toàn bộ batch đi trong
**một** transaction, giữ **một** lock trên bảng, nạp field **một** lần.

```ts
// Bulk insert — 1 request, 1 transaction, all-or-nothing.
const { created, records } = await invoices.createMany([
  { "Số hóa đơn": "INV-001", "Tổng tiền": 500_000 },
  { "Số hóa đơn": "INV-002", "Tổng tiền": 750_000 },
]);

// Bulk update theo query — 1 câu UPDATE cho mọi dòng khớp filter.
const result = await invoices
  .records()
  .where("Trạng thái", "equals", "draft")
  .where("Hạn thanh toán", "less_than", "2026-01-01")
  .update({ "Trạng thái": "overdue", "Ghi chú": null });   // null = xoá field
// { matched, updated, hasMore }
```

Những điều cần nhớ:

- **All-or-nothing.** Một dòng sai validation là cả batch bị từ chối, lỗi nêu
  rõ chỉ số dòng (`Record 7: ...`) — không bao giờ có bảng nhập dở.
- **Trần.** Insert tối đa 500 record/lần (SDK tự chia batch lớn hơn); update
  tối đa 5 000 dòng/lần. Khớp nhiều hơn thì `hasMore = true` — gọi lại đúng
  câu đó đến khi `false`.
- **Field `unique` không set được bằng bulk update** (một giá trị cho nhiều
  dòng thì tự đụng nhau) — 409. Xoá (`null`) thì được, vì giá trị rỗng không
  nằm trong unique index. Muốn set thì ghi từng record.
- **Field computed** (`formula`/`lookup`/`rollup`) được đánh dấu *stale* để
  worker tính lại, thay vì tính ngay trong lệnh ghi. Đọc lại ngay sau khi ghi
  có thể thấy `computeStatus: "stale"` — chờ worker vài giây.
- **Rule** vẫn chạy cho từng record như khi ghi lẻ. Bảng không có rule nào thì
  chỉ tốn đúng một câu đếm cho cả batch.
- Row scope vẫn áp: bulk update chỉ chạm được những dòng actor có quyền sửa.
- Mỗi dòng của bulk insert mang link của riêng nó (xem phần `relation` bên
  dưới). Ngược lại, bulk **update** áp một patch cho mọi dòng khớp, nên
  `{ "Chi tiết": [] }` gỡ link của tối đa 5 000 record trong một lệnh — chạy
  `dryRun` xem `matched` trước khi bấm.

## Chạy thử trước khi ghi thật — `dryRun` và `ERP_ENV`

Mọi lệnh ghi record nhận `dryRun`. Backend chạy **đúng câu lệnh thật** —
validate field, kiểm unique, kiểm version, kiểm id relation, chạy rule, tính
computed field — rồi **rollback** transaction. Request sai thì hỏng y hệt, cùng
status cùng message; request đúng thì không để lại dấu vết nào: không record,
không link, không event, `version` không tăng.

```ts
const thu = await invoices
  .records()
  .where("Trạng thái", "equals", "draft")
  .update({ "Trạng thái": "overdue" }, { dryRun: true });
// { matched: 128, updated: 128, hasMore: false, dryRun: true } — chưa ghi gì
```

Thay vì rải cờ đó khắp script, đặt biến môi trường: **`ERP_ENV=development` biến
mọi lệnh ghi record thành dry run**, nên cùng một đoạn code chạy thử rồi chạy
thật mà không sửa dòng nào.

```bash
ERP_ENV=development node import.mjs   # validate đủ, không ghi
node import.mjs                        # không đặt ERP_ENV ⇒ production ⇒ ghi thật
```

```ts
app.mode          // "production" | "development" — từ ERP_ENV hoặc config.mode
app.dryRun        // ghi mặc định có phải dry run không
app.production()  // cùng credential, chế độ kia (cache riêng, đọc lại schema)

await invoices.create(row, { dryRun: false });  // ghi thật dù đang development
await invoices.create(row, { dryRun: true });   // thử dù đang production
await invoices.update(id, patch, { version: 3, dryRun: true });
```

`NODE_ENV` **không** được đọc — app chạy local vẫn thường phải ghi thật, để
`NODE_ENV` quyết định thì mọi lệnh ghi lúc dev sẽ im lặng biến mất. Giá trị
`ERP_ENV` lạ thì SDK ném lỗi chứ không đoán về `production`.

Hai điều phải nhớ:

- **`id` trả về từ dry-run create là id giả** — sinh ra rồi vứt, chưa bao giờ
  được lưu. Đừng cache, đừng điều hướng theo nó, đừng dùng làm khoá cho bước sau.
- Dry run chỉ có ở 4 endpoint ghi record. `delete`, `restore`, `createLink`,
  `deleteLink` **không có** — ở chế độ development chúng ném
  `DryRunUnsupportedError` (không xoá lén, cũng không giả vờ đã xoá); muốn xoá
  thật thì `{ dryRun: false }`. Đổi cấu trúc bảng (`createObject`, `addField`)
  cũng luôn chạy thật.

Kiểm tra đang ở chế độ nào: `npx erp doctor` (check `mode`) hoặc `npx erp whoami`.

## Link giữa các bảng (field `relation`)

Field `relation` ghi **thẳng trong `data`** như mọi field khác, giá trị là mảng
record id của bên kia theo đúng thứ tự muốn hiển thị. Cùng một request, cùng một
transaction với phần còn lại của dòng:

```ts
await orders.create({
  "Mã đơn": "DH-001",
  "Chi tiết": [lineId1, lineId2],
});
```

**Ngữ nghĩa là thay cả list**, không phải thêm/bớt — và `null` khác `[]`:

| Gửi gì | Kết quả |
| --- | --- |
| không có key trong `data` | link giữ nguyên |
| `"Chi tiết": null` | **giống hệt không gửi key** — link giữ nguyên |
| `"Chi tiết": [a, b]` | record link **đúng** a, b; link cũ khác biến mất |
| `"Chi tiết": []` | xoá sạch link của field đó |

Bất đối xứng đó là cố ý: hai giá trị mà form hay lỡ gửi ra nhất là `null` và
`[]`, nên cái an toàn được chọn làm nghĩa của `null`. Với field thường thì
ngược lại — `null` là *xoá giá trị*. Muốn thêm một link vào record đang có ba
link thì gửi cả bốn id:

```ts
const rec = await orders.records().whereIds([id]).first();
const dangCo = orders.linkedIds(rec, "Chi tiết");   // mảng id đọc từ data
await orders.update(id, { "Chi tiết": [...dangCo, lineId3] });
```

`linkedIds` đọc từ `data`: query (`POST /records/query`) trả **mọi** relation
outgoing dưới dạng mảng id, create/update trả những field vừa ghi, còn
`get(id)` **không** trả relation.

Trần là **100 id / field / record**, cho cả đọc lẫn ghi (và 20 000 link cho cả
request). Quan hệ dài hơn 100 không sửa inline được — đọc không đủ id để khai
lại cả list — nên phải dùng API link từng cái:

```ts
await invoices.createLink(invoiceId, "Khách hàng", customerRecordId);
await invoices.listLinks(invoiceId, "Khách hàng");            // direction mặc định "outgoing"
await invoices.listLinks(invoiceId, "Khách hàng", "incoming");
await invoices.deleteLink(invoiceId, "Khách hàng", customerRecordId);
```

SDK ném `RelationValueError` **trước khi gọi mạng** khi giá trị không phải mảng,
quá 100 phần tử, hoặc phần tử không phải id (ví dụ truyền nguyên `RecordDto` —
map sang `r.id` trước). Id sai (không tồn tại, không thuộc bảng đích, tự link
chính nó) thì server từ chối **cả request**, kể cả bulk.

Chỉ ghi được relation **của chính bảng đang ghi** (chiều outgoing). Chiều
incoming của 1-n không phải field của bảng này → `UnknownFieldError` / 400; muốn
sửa thì ghi ở phía bảng sở hữu field.

### `preload` — tránh vấn đề 1-n

Query trả về mảng **id** của quan hệ, muốn có dữ liệu của bên kia thì vẫn phải
đi thêm một lượt (`getMany`). `preload` giải quyết cả trang trong số câu query
cố định — 10 record hay 1 000 record thì số query như nhau.

```ts
const invoices = await app.object("Hóa đơn bán hàng");
const lines    = await app.object("Chi tiết hóa đơn");

// 1-n: field relation nằm ở bảng con, nên truyền FieldDto của nó.
const page = await invoices.records().preload(lines.field("Hóa đơn")).fetch();
for (const invoice of page.records) {
  const children = invoices.related(invoice, lines.field("Hóa đơn"));
}

// n-1: field nằm trên chính bảng đang query, chỉ cần tên.
const withParent = await lines.records().preload("Hóa đơn").fetch();
const parent = lines.related(withParent.records[0]!, "Hóa đơn")[0];
```

Chiều (`outgoing`/`incoming`) được suy ra từ việc field thuộc bảng nào, không
cần khai báo. Record được preload đọc dưới đúng row scope của actor, nên
preload không bao giờ lộ ra dòng mà actor không tự `get` được. Tối đa 10 quan
hệ mỗi query và 50 record con mỗi dòng (đổi bằng `{ limit }`, trần 100) — quá
trần thì bị cắt bớt, nên bảng con lớn vẫn nên query riêng có filter.

Preload **một tầng**. Một query neo ở một bảng có thể fan-out cả lên cha lẫn
xuống con trong cùng lệnh gọi — hóa đơn kèm cả khách hàng lẫn dòng hàng là hai
`preload` trên một request:

```ts
const orders = await app.object("Hóa đơn");
const items  = await app.object("Chi tiết hóa đơn");

const page = await orders
  .records()
  .preload("Khách")                    // n-1: đi lên user
  .preload(items.field("Hóa đơn"))     // 1-n: đi xuống items
  .fetch();

for (const order of page.records) {
  const customer = orders.related(order, "Khách")[0];
  const lines    = orders.related(order, items.field("Hóa đơn"));
}
```

Nhưng record được preload **không** mang `related` của riêng nó, nên chuỗi
user → hóa đơn → items (neo ở user) là hai lượt gọi: query user kèm preload hóa
đơn, rồi query items lọc theo danh sách hóa đơn id vừa lấy.

`preload` cũng dùng được với view: `POST /objects/:id/views/:viewId/query`
nhận cùng tham số.

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
