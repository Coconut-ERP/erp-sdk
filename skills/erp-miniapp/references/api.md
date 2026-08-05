# erp-sdk — bề mặt API

Node 18+ (dùng `fetch` toàn cục). ESM + CJS. `import { … } from "erp-sdk"`.

## Khởi tạo

```ts
createMiniApp(config): Promise<ErpClient>
// config: { baseUrl, apiKey?, accessToken?, workspaceId?, permissions?, fetch? }
```

Cần `apiKey` (`erp_sk_…`) **hoặc** `accessToken`. Có `permissions` thì kiểm tra
ngay lúc boot → `MissingPermissionsError`. API key tự ghim workspace của nó, không
cần truyền `workspaceId`.

## ErpClient

| Method | Ghi chú |
| --- | --- |
| `me(refresh?)` | User hiện tại (key service account có thể không có) |
| `myPermissions(refresh?)` | Permission hiệu lực, có cache |
| `can(resource, action)` | Preflight nhanh; deny thắng allow, `manage` không suy ra hành động khác |
| `assertPermissions(extra?)` | Ném `MissingPermissionsError` nếu thiếu |
| `objects(refresh?)` | Danh sách object |
| `object(nameOrId)` | `ObjectHandle` (tự nạp field, có cache) |
| `hasObject(nameOrId)` | boolean |
| `assertSchema(schema, { refresh? })` | **Cách mini app kiểm tra bảng**: khớp `schema.json` → `Record<tên bảng, ObjectHandle>`; lệch → `SchemaMismatchError` |
| `schemaPlan(schema, { refresh? })` | Diff như màn duyệt, không throw → `SchemaObjectPlan[]` |
| `createObject(name, { position? })` | Tạo bảng rỗng — **cần key admin**, mini app không có quyền này |
| `ensureObject(name, fields[])` | Idempotent tạo bảng + field (key admin, dùng cho tooling) |
| `deleteObject(nameOrId)` | Xóa bảng (key admin) |
| `issueInitData(serviceAccountId)` | Phía app chủ: phát chuỗi đã ký |
| `session(initData)` | Phía mini app: `{ user, client, expiresIn }` đã xác minh |
| `asUser(accessToken, workspaceId?)` | Client chạy theo quyền của user |
| `invalidate()` | Xóa mọi cache |

## ObjectHandle

`id`, `name`, `fields`, `field(nameOrKey)`, `fieldKey(nameOrKey)`

```ts
handle.records()                      // → RecordQuery
handle.create(data)                   // key theo display name hoặc field key
handle.get(id)
handle.update(id, data, version?)     // không truyền version thì tự đọc trước
handle.delete(id, version?)           // soft delete
handle.restore(id, version)
handle.addField(name, type, { config?, position? })
handle.updateField(nameOrKey, { name?, config?, position?, isArchived? })
handle.rename(name)
handle.createLink(recordId, field, targetId, position?)
handle.listLinks(recordId, field, direction?)
handle.deleteLink(recordId, field, targetId)
handle.rowFromRecord(record, by?)     // RecordDto → row phẳng (cột = tên field)
```

`addField` / `updateField` / `rename` cũng cần key admin — mini app chỉ đọc
metadata và đọc/ghi record.

Field types: `text`, `long_text`, `number`, `currency`, `percent`, `checkbox`,
`date`, `datetime`, `single_select`, `multi_select`, `url`, `email`, `phone`,
`relation`, `lookup`, `rollup`, `formula`, `attachment`. Ba kiểu computed
(`formula`, `lookup`, `rollup`) **không khai báo được** trong `schema.json`.

## schema.json helpers (thuần hàm, không gọi mạng)

```ts
interface MiniAppSchema { objects: { name: string; position?: number;
  fields?: { name: string; type: string; config?: object; position?: number }[] }[] }

type SchemaStatus = "none" | "pending" | "applied";
type SchemaAction = "create" | "update" | "unchanged" | "conflict";
```

| Export | Ghi chú |
| --- | --- |
| `validateSchema(value)` | `string[]` mọi lỗi backend bắt lúc upload; rỗng = hợp lệ |
| `planSchema(schema, workspace)` | Diff offline (`workspace`: `{ name, fields: [{ name, type }] }[]`) |
| `schemaSettled(plans)` / `schemaConflicts(plans)` | Không còn gì để duyệt / danh sách xung đột type |
| `unresolvedRelations(schema, workspace)` | Relation trỏ tới bảng không tồn tại |
| `schemaSize(schema)` · `relationTarget(field)` · `defineSchema(schema)` | Tiện ích |
| `SCHEMA_FILE` · `FIELD_TYPES` · `DECLARABLE_FIELD_TYPES` · `COMPUTED_FIELD_TYPES` | Hằng số |
| `MAX_SCHEMA_BYTES` (256KB) · `MAX_SCHEMA_OBJECTS` (50) · `MAX_SCHEMA_FIELDS` (200) · `MAX_NAME_LENGTH` (255) | Giới hạn |

## RecordQuery (chainable)

```ts
.where(field, operator, value?)   // tối đa 20
.orderBy(field, "asc" | "desc")   // tối đa 3
.limit(n)                          // server max 100
.cursor(c) .withTotal()
await .fetch()                     // { records, nextCursor, hasMore, total? }
await .fetchAll({ max? })          // tự phân trang
await .first() / .count()
await .toFrame({ by?, max? })      // → DataFrame
```

## DataFrame

Bất biến, mọi method trả frame mới. Cột = **display name** của field (kèm `id`,
`version`, `createdAt`, `updatedAt`, và computed field).

`filter`, `where`, `map`, `forEach`, `select`, `rename`, `sortBy`, `unique`,
`uniqueBy`, `pluck`, `head`, `tail`, `slice`, `first`, `last`, `at`, `sum`,
`avg`, `min`, `max`, `count`, `isEmpty`, `countBy`, `keyBy`,
`groupBy().agg()/count()/sum()/avg()`, `leftJoin`, `toArray`.

```ts
df.groupBy("Khách hàng")
  .agg({ revenue: ["sum", "Tổng tiền"], orders: ["count"] })
  .sortBy("revenue", "desc").head(5).toArray();
```

## Bridge initData (browser)

```ts
readInitDataFromLocation()                  // #erpInitData=… hoặc ?erpInitData=…
receiveInitData({ allowedOrigins, timeoutMs? })   // postMessage; "*" bị từ chối
sendInitDataToFrame(target, initData, targetOrigin)  // phía app chủ
parseInitData(initData)                     // CHƯA xác minh — chỉ để hiển thị
INIT_DATA_MESSAGE_TYPE  // "erp-miniapp:init-data"
INIT_DATA_URL_PARAM     // "erpInitData"
```

## Error

| Class | Trường hữu ích |
| --- | --- |
| `MissingPermissionsError` | `.missing` |
| `SchemaMismatchError` | `.missing`, `.conflicts` (`{ object, field?, type?, currentType? }`) |
| `ErpApiError` | `.status`, `.trace`, `.details` |
| `UnknownObjectError` | `.object` |
| `UnknownFieldError` | `.field`, `.objectName`, `.known` |
