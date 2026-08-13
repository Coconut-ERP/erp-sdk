# erp-sdk — bề mặt API

Node 18+ (dùng `fetch` toàn cục). ESM + CJS. `import { … } from "erp-sdk"`.
Không có dependency runtime nào ngoài lodash.

## Khởi tạo

```ts
createMiniApp(config): Promise<ErpClient>
// config: { baseUrl, apiKey?, accessToken?, workspaceId?, permissions?,
//           mode?, env?, fetch? }
```

Cần `apiKey` (`erp_sk_…` service account, hoặc `erp_uk_…` user key) **hoặc**
`accessToken` (JWT của user). API key tự ghim workspace của nó — chỉ truyền
`workspaceId` khi dùng `accessToken`. Có `permissions` thì SDK gọi
`/iam/me/permissions` ngay lúc khởi tạo và ném `MissingPermissionsError` liệt kê
chính xác cặp `resource:action` còn thiếu.

Tên hàm là `createMiniApp` vì lịch sử (SDK sinh ra cho mini app), nhưng nó là
factory chung cho mọi client — script phân tích, job đồng bộ, CLI nội bộ đều dùng
hàm này.

`fetch` truyền vào được → test không cần mạng.

## Chế độ chạy (`ERP_ENV`)

```ts
type ErpMode = "production" | "development";
resolveMode(env?): ErpMode        // đọc ERP_ENV; không đặt → "production"
isDryRunMode(mode): boolean
ERP_ENV_VAR                        // "ERP_ENV"
```

`ERP_ENV=development` (alias: `dev`, `dry-run`) làm **mọi lệnh ghi record** mặc
định `dryRun: true`; `production` (alias `prod`, `live`) hoặc không đặt thì ghi
thật. Giá trị lạ → ném lỗi, không đoán. `NODE_ENV` cố tình **không** được đọc.
`config.mode` đè lên env; `config.env` chỉ định nơi đọc biến (tiện cho test).

Server chạy đúng lệnh thật rồi rollback: sai vẫn lỗi y hệt, đúng thì không để
lại record/link/event nào và `version` không tăng. **Id trả về từ dry-run create
là id giả, chưa từng lưu.**

Dry run chỉ có ở `create`, `createMany`, `update`, `updateWhere`. `delete`,
`restore`, `createLink`, `deleteLink` ném `DryRunUnsupportedError` khi client
đang ở development; đổi cấu trúc bảng thì luôn chạy thật.

## ErpClient

| Method | Ghi chú |
| --- | --- |
| `mode` · `dryRun` | Chế độ hiện tại và ghi có phải dry run không (thuộc tính) |
| `production()` · `development()` · `withMode(mode)` | Cùng credential, chế độ khác — cache riêng nên đọc lại object/field |
| `objects(refresh?)` | `ObjectDto[]` — id, name, position (có cache) |
| `object(nameOrId)` | `ObjectHandle`; resolve theo id → tên chính xác → tên không phân biệt hoa thường, cache theo cả hai khóa |
| `hasObject(nameOrId)` | boolean, không ném lỗi |
| `me(refresh?)` | User hiện tại — key service account **không có** `/users/me`, sẽ ném lỗi |
| `myPermissions(refresh?)` | `PermissionDto[]` hiệu lực, có cache |
| `can(resource, action)` | Preflight; deny thắng allow, `manage` không suy ra hành động khác |
| `assertPermissions(extra?)` | Ném `MissingPermissionsError` nếu thiếu (refresh cache trước) |
| `asUser(accessToken, workspaceId?)` | Client mới chạy theo quyền + row scope của user đó |
| `session(initData)` | Đổi initData đã ký → `{ user, client, expiresIn }` |
| `issueInitData(serviceAccountId)` | Phía app chủ: phát chuỗi initData cho một mini app |
| `assertSchema(schema, { refresh? })` | Khớp `schema.json` → `Record<tên bảng, ObjectHandle>`; lệch → `SchemaMismatchError` |
| `schemaPlan(schema, { refresh? })` | Diff như màn duyệt, không ném lỗi → `SchemaObjectPlan[]` |
| `createObject(name, { position? })` | **Cần key admin** — service account `member` nhận 403 |
| `ensureObject(name, fields[])` | Idempotent tạo bảng + field còn thiếu (key admin) |
| `deleteObject(nameOrId)` | Xóa bảng và record của nó (key admin) |
| `invalidate()` | Xóa mọi cache (objects, fields, permissions, me) |

Sau khi đổi cấu trúc (thêm field, đổi tên bảng) phải `invalidate()` hoặc
`objects(true)`, nếu không handle cache còn giữ schema cũ.

## ObjectHandle

Thuộc tính: `id`, `name`, `meta` (`ObjectDto`), `fields` (`FieldDto[]`).

| Method | Ghi chú |
| --- | --- |
| `field(nameOrKey)` | `FieldDto`; sai → `UnknownFieldError` kèm `.known` |
| `fieldKey(nameOrKey)` | Key nội bộ của field |
| `records()` | `RecordQuery` mới |
| `get(id)` | `RecordDto` |
| `getMany(ids, { chunkSize? })` | 1 request/200 id, giữ thứ tự đầu vào; id bị row scope chặn hoặc đã xóa thì vắng mặt (không lỗi) |
| `create(data, { dryRun? })` | Key theo tên hiển thị **hoặc** field key |
| `createMany(rows, { chunkSize?, dryRun? })` | Bulk insert, tự chia lô ≤ 500; mỗi lô 1 transaction all-or-nothing |
| `update(id, data, version \| { version?, dryRun? })` | Không truyền version thì `get` trước để lấy; lệch version → 409 |
| `updateWhere(filters, data, { limit?, dryRun? })` | Bulk update theo filter (dùng key nội bộ) |
| `delete(id, version \| { version?, dryRun? })` | Soft delete — không dry run được |
| `restore(id, version)` | Khôi phục — không dry run được |
| `related(record, field)` | Record đã `preload` → `RecordDto[]` |
| `linkedIds(record, field)` | Mảng id trong `data` của field `relation` (record phải lấy bằng query, không phải `get`) |
| `rowFromRecord(record, by?)` | `RecordDto` → dòng phẳng; `by = "name"` (mặc định) hoặc `"key"` |
| `listLinks` · `createLink` · `deleteLink` | Sửa từng link — chỉ cần khi quan hệ > 100 id |
| `addField` · `updateField` · `rename` | **Key admin** — sửa cấu trúc bảng |

Field types: `text`, `long_text`, `number`, `currency`, `percent`, `checkbox`,
`date`, `datetime`, `single_select`, `multi_select`, `url`, `email`, `phone`,
`relation`, `lookup`, `rollup`, `formula`, `attachment`.

`rowFromRecord` trả `id`, `version`, `createdAt`, `updatedAt` cộng mọi giá trị
trong `data` + `computedData`, cột đặt theo tên hiển thị.

### Field `relation` trong `data`

Ghi như field thường, giá trị là **mảng record id** theo thứ tự muốn hiển thị —
cùng transaction với cả dòng, không cần `createLink` sau đó.

| Gửi | Nghĩa |
| --- | --- |
| không có key | link giữ nguyên |
| `null` | **giống hệt không gửi key** — link giữ nguyên (khác field thường: ở đó `null` là xoá giá trị) |
| `[a, b]` | link **đúng** a, b; link cũ khác biến mất |
| `[]` | xoá sạch link của field đó |

Tối đa `MAX_RELATION_IDS` = **100 id / field / record** (cả đọc lẫn ghi), 20 000
link / request. Dài hơn 100 thì không sửa inline được — dùng
`createLink`/`deleteLink`. SDK ném `RelationValueError` trước khi gọi mạng khi
mảng quá 100, phần tử không phải id (ví dụ truyền nguyên `RecordDto`), hoặc giá
trị không phải mảng. Một id sai (không tồn tại, sai bảng đích, tự link chính nó)
làm hỏng **cả request**, kể cả bulk.

Đọc: `POST /records/query` trả **mọi** relation field outgoing dưới dạng mảng id
(rỗng nếu không có link); create/update chỉ trả những field vừa ghi; `get(id)`
**không** trả relation.

## RecordQuery (chainable, có trạng thái)

```ts
.where(field, operator, value?)      // tối đa 20 filter
.whereIn(field, values) / .whereNotIn(field, values)
.whereIds(ids)                        // lọc theo id của chính record
.orderBy(field, "asc" | "desc")       // tối đa 3
.preload(field, { limit?, direction? })   // tối đa 10, tránh N+1
.limit(n)                             // server max 100
.cursor(c) .withTotal()
.build()                              // xem body sẽ gửi đi (debug)

await .fetch()                        // { records, nextCursor, hasMore, total? }
await .fetchAll({ max? })             // tự đi hết cursor, mỗi trang 100
await .first()                        // set limit(1)
await .count()                        // set limit(1).withTotal()
await .update(data, { limit?, dryRun? })  // bulk update mọi dòng khớp filter
await .toFrame({ by?, max? })         // fetchAll + rowFromRecord → DataFrame
```

`first()` và `count()` **sửa chính query đó** (`limit`) — dựng chain mới cho mỗi
lần gọi thay vì tái sử dụng.

Toán tử (`FilterOperator`): `equals`, `not_equals`, `contains`, `in`, `not_in`,
`greater_than`, `greater_than_or_equal`, `less_than`, `less_than_or_equal`,
`is_empty`, `is_not_empty`. `in`/`not_in` nhận mảng 1..200 (`MAX_FILTER_VALUES`),
sai shape → `FilterValueError` **trước khi** gọi mạng. `not_in` cũng khớp cả
record chưa có giá trị (giống server).

`preload(field)`: tên field `relation` của chính bảng đang query (n-1), hoặc
`FieldDto` của bảng khác trỏ về bảng này (1-n) — chiều tự suy ra, đọc kết quả
bằng `handle.related(record, field)`.

Bulk update: ≤ 5 000 dòng/lần, trả `{ matched, updated, hasMore, dryRun? }`;
field `unique` không set được bằng bulk; computed field do worker tính lại. Patch
áp cho **mọi** dòng khớp, nên relation trong patch ghi đè list của từng dòng —
`{ "Chi tiết": [] }` gỡ link của tối đa 5 000 record trong một lệnh. Chạy
`{ dryRun: true }` để lấy `matched` thật trước khi làm.

## DataFrame

Bất biến — mọi method trả frame mới. Cột = **tên hiển thị** của field, cộng `id`,
`version`, `createdAt`, `updatedAt` và các cột computed.

| Nhóm | Method |
| --- | --- |
| Chọn dòng | `filter`, `where(field, op, value)`, `head`, `tail`, `slice`, `unique`, `uniqueBy` |
| Chọn cột | `select`, `rename`, `pluck`, `map` |
| Sắp xếp | `sortBy(fields, directions)` |
| Tổng hợp | `sum`, `avg`, `min`, `max`, `count`, `isEmpty`, `countBy`, `keyBy` |
| Nhóm | `groupBy(field \| fn, { as? })` → `.agg({})`, `.count()`, `.sum(f, as?)`, `.avg(f, as?)`, `.frames()` |
| Nối | `leftJoin(other, leftKey, rightKey?, { prefix? })` |
| Lấy ra | `toArray`, `first`, `last`, `at`, `forEach` |

`agg` nhận `["count"]`, `["sum"\|"avg"\|"min"\|"max", cột]`, hoặc một hàm
`(rows) => giá trị`. Giá trị không phải số được ép về số (chuỗi không parse được
thành `0`), nên cột tiền/số phải sạch trước khi `sum`.

`where` trên frame dùng cùng bộ toán tử với server (`matchesOperator` cũng được
export nếu cần dùng riêng).

## schema.json (thuần hàm, không gọi mạng)

```ts
interface MiniAppSchema { objects: { name: string; position?: number;
  fields?: { name: string; type: string; config?: object; position?: number }[] }[] }
```

| Export | Ghi chú |
| --- | --- |
| `validateSchema(value)` | `string[]` mọi lỗi backend bắt lúc upload; rỗng = hợp lệ |
| `planSchema(schema, workspace)` | Diff offline; `workspace`: `{ name, fields: [{ name, type }] }[]` — chính là output của `erp schema dump` |
| `schemaSettled(plans)` · `schemaConflicts(plans)` | Không còn gì để duyệt / danh sách xung đột kiểu |
| `unresolvedRelations(schema, workspace)` | Relation trỏ bảng không tồn tại |
| `schemaSize` · `relationTarget` · `defineSchema` | Tiện ích |
| `SCHEMA_FILE` · `FIELD_TYPES` · `DECLARABLE_FIELD_TYPES` · `COMPUTED_FIELD_TYPES` | Hằng số |
| `MAX_SCHEMA_BYTES` (256KB) · `MAX_SCHEMA_OBJECTS` (50) · `MAX_SCHEMA_FIELDS` (200) · `MAX_NAME_LENGTH` (255) | Giới hạn |

`formula`, `lookup`, `rollup` **không khai báo được** — config của chúng trỏ tới
field khác bằng key nội bộ, phải tạo tay trong workspace.

## Quyền

```ts
isAllowed(permissions, resource, action): boolean
missingPermissions(permissions, required): RequiredPermission[]
```

Mirror của enforcer phía backend: deny thắng allow, `*` là wildcard, `manage`
không suy ra hành động nào khác.

## HTTP

`FetchHttp` tự thêm `/api/v1`, set `X-API-Key` hoặc `Authorization: Bearer`, bóc
vỏ `{ success, data, message, trace }` và ném `ErpApiError` khi không 2xx.
Truy cập trực tiếp qua `client.http.request(method, path, { body, query })` khi
cần endpoint SDK chưa bọc.

## Error

| Class | Trường hữu ích |
| --- | --- |
| `MissingPermissionsError` | `.missing` |
| `UnknownObjectError` | `.object` |
| `UnknownFieldError` | `.field`, `.objectName`, `.known` |
| `FilterValueError` | `.field`, `.operator` |
| `RelationValueError` | `.field`, `.reason` |
| `DryRunUnsupportedError` | `.operation` |
| `SchemaMismatchError` | `.missing`, `.conflicts` (`{ object, field?, type?, currentType? }`) |
| `ErpApiError` | `.status`, `.trace`, `.details` |

## Bridge initData (browser, chỉ dùng cho mini app)

`readInitDataFromLocation()`, `receiveInitData({ allowedOrigins, timeoutMs? })`,
`sendInitDataToFrame(target, initData, targetOrigin)`, `parseInitData(initData)`
(**chưa xác minh** — chỉ để hiển thị), `INIT_DATA_MESSAGE_TYPE`,
`INIT_DATA_URL_PARAM`. `"*"` bị từ chối ở cả hai chiều.
