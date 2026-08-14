# `schema.json` — bảng app cần

App **không tạo được bảng**. Nó khai báo, người deploy duyệt và tạo bằng quyền
của chính họ. File nằm ở **gốc source** (gốc zip; nếu zip có đúng một thư mục
gốc thì là gốc thư mục đó).

## Format

Payload kế thừa nguyên từ object API: một phần tử `objects` = body của
`POST /objects` (`name`, `position`) cộng `fields`; một phần tử `fields` = body
của `POST /objects/:id/fields` (`name`, `type`, `config`, `position`).

```json
{
  "objects": [
    {
      "name": "Đơn xin nghỉ",
      "position": 0,
      "fields": [
        { "name": "Người xin nghỉ", "type": "single_select",
          "config": { "source": "workspace_users" }, "position": 0 },
        { "name": "Lý do", "type": "long_text", "position": 1 },
        { "name": "Từ ngày", "type": "date", "position": 2 },
        { "name": "Số ngày", "type": "number", "position": 3 },
        { "name": "Trạng thái", "type": "single_select",
          "config": { "source": "static",
                      "options": ["pending", "approved", "rejected"] },
          "position": 4 }
      ]
    }
  ]
}
```

Key lạ trong JSON bị **từ chối** — chỉ `objects` ở gốc; `name`/`position`/`fields`
ở object; `name`/`type`/`config`/`position` ở field.

## Field type

| Nhóm | Type |
| --- | --- |
| Chữ | `text`, `long_text`, `url`, `email`, `phone` |
| Số | `number`, `currency`, `percent` |
| Ngày | `date`, `datetime` |
| Chọn | `single_select`, `multi_select`, `checkbox` |
| Khác | `relation`, `attachment` |
| **Không khai báo được** | `formula`, `lookup`, `rollup` |

Computed (`formula`/`lookup`/`rollup`) không khai báo được vì config của chúng
trỏ tới field khác bằng **key nội bộ** mà app không biết. Cần thì tạo tay trong
workspace; app đọc chúng ở `record.computedData`.

Hằng số tương ứng trong SDK: `FIELD_TYPES`, `DECLARABLE_FIELD_TYPES`,
`COMPUTED_FIELD_TYPES`.

### `config` hay dùng

```json
{ "type": "single_select", "config": { "source": "workspace_users" } }
```
Giá trị lưu là **user id** — dùng cho field "người tạo", "người duyệt".

```json
{ "type": "single_select", "config": { "source": "static", "options": ["a", "b"] } }
```

```json
{ "type": "relation", "config": { "targetObject": "Khách hàng" } }
```
`targetObject` là **tên bảng** (app không biết id). Target phải là bảng khai
cùng file hoặc bảng đã có trong workspace — nếu không, `unresolvedRelations()`
bắt được và backend trả 400.

## Luật backend áp lúc upload

| Luật | Giới hạn |
| --- | --- |
| Tên không trùng (không phân biệt hoa thường) | trong cùng file |
| Độ dài tên | ≤ 255 (`MAX_NAME_LENGTH`) |
| Số bảng | ≤ 50 (`MAX_SCHEMA_OBJECTS`) |
| Số field / bảng | ≤ 200 (`MAX_SCHEMA_FIELDS`) |
| Kích thước file | ≤ 256KB (`MAX_SCHEMA_BYTES`) |
| `position` | số nguyên ≥ 0 |

Sai bất kỳ điểm nào → **400 ngay lúc upload zip**. Message của backend chỉ đúng
chỗ sai — hiện thẳng cho người dùng.

## Kiểm trước, không cần credential

Toàn bộ là **hàm thuần**, cùng bộ luật với backend:

```js
import { readFileSync } from "node:fs";
import {
  validateSchema, planSchema, schemaConflicts,
  schemaSettled, unresolvedRelations, schemaSize,
} from "erp-sdk";

const schema = JSON.parse(readFileSync("schema.json", "utf8"));

validateSchema(schema);        // string[] mọi lỗi backend sẽ bắt; [] = hợp lệ

// Diff với workspace thật: npx erp schema dump --out workspace.json
const workspace = JSON.parse(readFileSync("workspace.json", "utf8")).objects;
const plans = planSchema(schema, workspace);
schemaConflicts(plans);        // [] = không xung đột kiểu
schemaSettled(plans);          // true = không còn gì để duyệt
unresolvedRelations(schema, workspace);   // relation trỏ bảng không tồn tại
```

Có client rồi thì `await app.schemaPlan(schema)` làm cả hai bước (đọc workspace
+ diff), không throw.

`action` của mỗi bảng/field — đúng thứ màn duyệt hiển thị:

| action | Nghĩa |
| --- | --- |
| `create` | chưa có, sẽ được tạo |
| `update` | (cấp bảng) bảng đã có nhưng thiếu field |
| `unchanged` | đã có sẵn, không đụng tới |
| `conflict` | (cấp field) trùng tên, **khác type** — kèm `currentType` |

## `assertSchema` lúc boot

```ts
const handles = await app.assertSchema(schema);
const leaves = handles["Đơn xin nghỉ"];        // key = đúng tên đã khai báo
```

Khớp → trả `Record<tên bảng, ObjectHandle>`. Lệch → throw `SchemaMismatchError`
với `.missing` (bảng/field thiếu) và `.conflicts` (trùng tên khác type), message
đã kèm hướng dẫn nhờ người deploy duyệt.

Gọi **một lần lúc boot**, không gọi trong route handler. `{ refresh: true }` để
bỏ cache khi workspace vừa bị sửa.

## Đổi schema về sau

1. Sửa `schema.json`
2. Upload version mới (`PUT /mini-apps/:id/source`)
3. Người deploy duyệt lại

Chỉ **thêm** được. Đổi kiểu field đã có là `conflict` → phải sửa tay trong
workspace (hoặc sửa khai báo cho khớp) rồi duyệt lại. Xoá bảng/field cũng là
việc làm tay trong workspace — gỡ app **không** xoá bảng dữ liệu.

## Escape hatch: tạo bảng bằng key admin

`createObject` / `ensureObject` / `addField` vẫn còn trong SDK, nhưng **không
dành cho app** — gọi từ app chỉ ra 403. Chúng dành cho script tooling chạy bằng
**key admin**, ví dụ dựng workspace demo trước khi cài app:

```js
await adminClient.ensureObject("Đơn xin nghỉ", [
  { name: "Lý do", type: "long_text" },
  { name: "Số ngày", type: "number" },
]);
```

Đổi cấu trúc workspace của người dùng là việc lớn — **hỏi trước khi làm**. Sau
khi đổi phải `client.invalidate()`, nếu không handle cache còn giữ field cũ.
Đổi cấu trúc **không có dry run**: `ERP_ENV=development` không bảo vệ được ở đây.
