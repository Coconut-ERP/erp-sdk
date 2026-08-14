# 08 — API reference

[← Triển khai](07-trien-khai-van-hanh.md) · [Mục lục](README.md) · [Tiếp: Tutorial →](09-tutorial-leave-request.md)

Toàn bộ export của `erp-sdk`. Mọi method mạng đều trả Promise và có thể
throw `ErpApiError`.

## createMiniApp

```ts
function createMiniApp(config: MiniAppConfig): Promise<ErpClient>

interface MiniAppConfig {
  baseUrl: string;                    // SDK tự thêm /api/v1
  apiKey?: string;                    // API key IAM (erp_sk_... service account, erp_uk_... user) — header X-API-Key
  accessToken?: string;               // hoặc JWT user (header Authorization: Bearer)
  workspaceId?: string;               // cần khi dùng accessToken và user không có default workspace;
                                      // bị bỏ qua khi dùng apiKey (key tự pin workspace)
  permissions?: RequiredPermission[]; // quyền app cần — verify ngay, thiếu → MissingPermissionsError
  mode?: "production" | "development";// đè lên ERP_ENV; development = mọi lệnh ghi record là dry run
  env?: Record<string, string | undefined>; // nơi đọc ERP_ENV (mặc định process.env)
  fetch?: typeof fetch;               // custom fetch (test/proxy)
}
```

Throw nếu không có `apiKey` lẫn `accessToken`. SDK không kiểm tra prefix của
key — key sai/hết hạn sẽ lộ ra ở request đầu tiên dưới dạng `ErpApiError` 401.
(`API_KEY_PREFIX = "erp_sk_"` vẫn export để tham chiếu, không còn dùng để
validate.)

## Chế độ chạy — `ERP_ENV`

```ts
type ErpMode = "production" | "development";
function resolveMode(env?: Record<string, string | undefined>): ErpMode;
function isDryRunMode(mode: ErpMode): boolean;
const ERP_ENV_VAR = "ERP_ENV";
```

Không đặt `ERP_ENV` → `production`, ghi thật. `development` (alias `dev`,
`dry-run`) → **mọi lệnh ghi record mặc định `dryRun: true`**: server chạy đúng
câu lệnh thật rồi rollback. Giá trị lạ → throw, không đoán. `NODE_ENV` cố ý
không được đọc. Chi tiết và các bẫy: [03 — Dữ liệu](03-du-lieu.md).

## ErpClient

| Method | Mô tả |
| --- | --- |
| `me(refresh?)` | `UserDto` của actor hiện tại (service account hoặc user). Cache; `refresh: true` để nạp lại |
| `asUser(accessToken, workspaceId?)` | Client mới hành động dưới quyền user (JWT). Chỉ dùng được trên client tạo bởi `createMiniApp` |
| `session(initData)` | Đổi initData → `{ user: UserDto, client: ErpClient, expiresIn: number }`. `client` mang quyền user |
| `issueInitData(serviceAccountId)` | (Phía app chủ) mint initData cho user hiện tại → `{ initData, expiresIn }` |
| `sql(sql, { params?, values? })` | Chạy một `SELECT` read-only trên tên bảng/cột hiển thị → `QueryResult`. Chi tiết: [11](11-truy-van-sql-dashboard.md) |
| `dashboards` | `DashboardsApi` (thuộc tính) — dashboard và query đã lưu |
| `dashboard(nameOrId)` | `DashboardHandle` kèm query của nó; không thấy → `UnknownDashboardError` |
| `workflows` | `WorkflowsApi` (thuộc tính) — script chạy trên server |
| `workflow(nameOrId)` | `WorkflowHandle` (đã nạp `code`); không thấy → `UnknownWorkflowError`. Không cache: version đổi sau mỗi lần ghi |
| `objects(refresh?)` | `ObjectDto[]` mọi object trong workspace. Cache |
| `object(nameOrId)` | `ObjectHandle` — resolve theo id, tên, tên không phân biệt hoa thường. Không thấy → `UnknownObjectError`. Cache |
| `hasObject(nameOrId)` | `boolean` |
| `assertSchema(schema, { refresh? })` | Đối chiếu `schema.json` với workspace; khớp → `Record<tên bảng, ObjectHandle>`, lệch → `SchemaMismatchError`. **Cách kiểm tra schema dành cho mini app** |
| `schemaPlan(schema, { refresh? })` | `SchemaObjectPlan[]` — diff y như màn duyệt, không throw |
| `createObject(name, { position? })` | Tạo object mới → handle. **Cần key admin** — mini app không có `object:create` |
| `ensureObject(name, fields?)` | Idempotent: lấy hoặc tạo object, thêm field còn thiếu (`EnsureFieldSpec[]`). Cùng giới hạn quyền như trên |
| `deleteObject(nameOrId)` | Xoá object (key admin) |
| `myPermissions(refresh?)` | `PermissionDto[]` hiệu lực. Cache |
| `can(resource, action)` | `boolean` — deny thắng allow, `*` wildcard |
| `assertPermissions(extra?)` | Verify quyền khai lúc tạo + `extra`; thiếu → `MissingPermissionsError` |
| `invalidate()` | Xoá mọi cache (permissions, objects, me, handles) |
| `mode` | `"production" \| "development"` — từ `config.mode` hoặc `ERP_ENV` (thuộc tính) |
| `dryRun` | `boolean` — ghi mặc định có phải dry run không (thuộc tính) |
| `withMode(mode)` · `production()` · `development()` | Cùng credential, chế độ khác. Cache riêng nên đọc lại object/field |
| `http` | `Http` — gọi endpoint tuỳ ý: `app.http.request<T>("GET", "/users/me")` |

## ObjectHandle

Thuộc tính: `id`, `name`, `meta: ObjectDto`, `fields: FieldDto[]`.

**Schema:**

| Method | Mô tả |
| --- | --- |
| `field(nameOrKey)` | `FieldDto` — không thấy → `UnknownFieldError` (`.known` = danh sách field) |
| `fieldKey(nameOrKey)` | key nội bộ của field |
| `filterKey(nameOrKey)` | Như `fieldKey`, nhưng `"id"` (khi không có field trùng tên) trả `"id"` — id của chính record |
| `addField(name, type, { config?, position? })` | Thêm field (key admin) |
| `updateField(nameOrKey, { name?, config?, position?, isArchived? })` | Sửa field (key admin) |
| `rename(name)` | Đổi tên object (key admin) |

**Record:** (mọi key data nhận tên hiển thị hoặc key)

| Method | Mô tả |
| --- | --- |
| `create(data, { dryRun? })` | Tạo record → `RecordDto`. Field `relation` nhận **mảng record id** |
| `createMany(rows, { chunkSize?, dryRun? })` | Bulk insert → `{ created, records, dryRun? }`. Một transaction, all-or-nothing; batch > 500 tự chia |
| `get(recordId)` | Lấy một record |
| `getMany(ids, { chunkSize? })` | Lấy nhiều record theo id — mỗi 200 id một request (`id in`), khử trùng lặp, giữ đúng thứ tự đã hỏi; id không đọc được thì vắng mặt |
| `update(recordId, data, version \| { version?, dryRun? })` | Sửa; không truyền `version` thì tự GET lấy (thêm 1 request). Version lệch → 409 |
| `updateWhere(filters, data, { limit?, dryRun? })` | Bulk update theo filter thô → `{ matched, updated, hasMore, dryRun? }`. Thường dùng dạng `records().where(...).update(...)` |
| `delete(recordId, version \| { version?, dryRun? })` | Soft delete — **không dry run được** |
| `restore(recordId, version)` | Khôi phục — **không dry run được** |
| `records()` | Mở `RecordQuery` |
| `related(record, field)` | Record đã `preload` → `RecordDto[]`; `field` là tên/key của bảng này, hoặc `FieldDto` của bảng khác |
| `linkedIds(record, field)` | Mảng id trong `data` của một field `relation` (record phải lấy bằng query, không phải `get`) |
| `rowFromRecord(record, by = "name")` | Record → object phẳng theo tên/key field, kèm `id`, `version`, `createdAt`, `updatedAt`, merge `computedData` |

**Links (field `relation`):** cách chính là ghi mảng id thẳng trong `data` của
`create`/`update` (thay cả list; `null` giữ nguyên, `[]` gỡ hết; tối đa
`MAX_RELATION_IDS` = 100 id/field/record). Ba hàm dưới đây dành cho quan hệ dài
hơn 100 — sửa từng link mà không phải khai lại cả list:

| Method | Mô tả |
| --- | --- |
| `createLink(recordId, field, targetRecordId, position = 0, { dryRun? })` | Nối record — không dry run được |
| `listLinks(recordId, field, direction = "outgoing")` | Liệt kê (`"outgoing"` \| `"incoming"`) |
| `deleteLink(recordId, field, targetRecordId, { dryRun? })` | Gỡ nối — không dry run được |

## schema.json helpers

Thuần hàm, không gọi mạng — dùng được cả trong script build.

```ts
interface MiniAppSchema { objects: SchemaObjectSpec[] }
interface SchemaObjectSpec { name: string; position?: number; fields?: SchemaFieldSpec[] }
interface SchemaFieldSpec { name: string; type: string; config?: Record<string, unknown>; position?: number }

type SchemaStatus = "none" | "pending" | "applied";
type SchemaAction = "create" | "update" | "unchanged" | "conflict";
```

| Export | Mô tả |
| --- | --- |
| `validateSchema(value)` | `string[]` — mọi lỗi backend sẽ bắt lúc upload (type lạ, computed field, trùng tên, key lạ, quá giới hạn). Rỗng = hợp lệ |
| `planSchema(schema, workspace)` | Diff offline → `SchemaObjectPlan[]` (`workspace` = `{ name, fields: [{ name, type }] }[]`) |
| `schemaSettled(plans)` | `true` khi không có gì để tạo → backend deploy thẳng |
| `schemaConflicts(plans)` | `string[]` mô tả field trùng tên khác type |
| `unresolvedRelations(schema, workspace)` | Relation trỏ tới bảng không khai báo và cũng không có sẵn |
| `schemaSize(schema)` | Số byte khi serialize (giới hạn `MAX_SCHEMA_BYTES`) |
| `relationTarget(field)` | `config.targetObject` đã trim |
| `defineSchema(schema)` | Identity, chỉ để có type khi khai schema bằng TS |
| `SCHEMA_FILE` | `"schema.json"` |
| `FIELD_TYPES` / `DECLARABLE_FIELD_TYPES` / `COMPUTED_FIELD_TYPES` | 18 kiểu field / khai báo được / computed (`formula`, `lookup`, `rollup`) |
| `MAX_SCHEMA_BYTES` · `MAX_SCHEMA_OBJECTS` · `MAX_SCHEMA_FIELDS` · `MAX_NAME_LENGTH` | 256KB · 50 · 200 · 255 |

## RecordQuery

Builder bất biến về mặt sử dụng — mỗi method trả `this`, kết thúc bằng một
lệnh thực thi:

```ts
q.where(field, operator, value?)   // AND; tối đa 20 (server)
 .whereIn(field, values)           // = where(field, "in", values), tối đa 200 giá trị
 .whereNotIn(field, values)        // = where(field, "not_in", values)
 .whereIds(ids)                    // lọc theo id record, tối đa 200
 .orderBy(field, "asc" | "desc")   // tối đa 3
 .preload(field, { limit?, direction? })  // nạp kèm quan hệ; tối đa 10
 .limit(n)                         // tối đa 100/trang
 .cursor(cursor)                   // phân trang
 .withTotal()                      // đếm tổng (thêm chi phí)
```

`preload(field)` nhận tên/key field relation của chính bảng đang query
(chiều `outgoing`, n-1) hoặc `FieldDto` của bảng khác trỏ về bảng này (chiều
`incoming`, 1-n) — chiều được suy ra, không cần truyền. Kết quả nằm ở
`record.related[fieldKey]`, đọc bằng `handle.related(record, field)`. Mặc định
50 record con mỗi dòng, trần 100.

| Thực thi | Trả về |
| --- | --- |
| `fetch()` | `RecordPage = { records, nextCursor?, hasMore, total? }` |
| `fetchAll({ max? })` | `RecordDto[]` — tự lặp cursor (100/trang) đến hết hoặc `max` |
| `first()` | `RecordDto \| undefined` |
| `count()` | `number` (dùng `withTotal` ngầm) |
| `update(data, { limit?, dryRun? })` | Bulk update mọi dòng khớp filter → `{ matched, updated, hasMore, dryRun? }`; `null` xoá field, tối đa 5 000 dòng/lần |
| `toFrame({ by?, max? })` | `DataFrame<Row>` — cột theo `"name"` (mặc định) hoặc `"key"` |
| `build()` | `QueryRecordsRequest` thô (tự gọi API) |

`FilterOperator`: `equals` · `not_equals` · `contains` · `in` · `not_in` ·
`greater_than` · `greater_than_or_equal` · `less_than` · `less_than_or_equal` ·
`is_empty` · `is_not_empty`.

`in` / `not_in` nhận **mảng 1–200 giá trị** (`RECORD_ID_FILTER_KEY`,
`MAX_FILTER_VALUES` được export); sai kiểu/rỗng/quá trần → `FilterValueError`
ném ngay client. Field `"id"` lọc theo id của chính record (chỉ `equals`,
`not_equals`, `in`, `not_in`); query có filter id sẽ bỏ COUNT trừ khi
`withTotal()`.

## DataFrame

`DataFrame.from(rows)` hoặc `query.toFrame()`. Bất biến — mọi method trả
frame/giá trị mới.

**Chọn & biến đổi:** `toArray()` · `count()` · `isEmpty()` · `first()` ·
`last()` · `at(i)` (âm = từ cuối) · `head(n=5)` · `tail(n=5)` ·
`slice(start, end?)` · `filter(fn)` · `where(field, op, value?)` ·
`map(fn)` · `forEach(fn)` · `select(...fields)` · `rename(mapping)` ·
`sortBy(fields, directions?)` · `unique()` · `uniqueBy(fieldOrFn)` ·
`pluck(field)`.

**Tổng hợp:** `sum(field)` · `avg(field)` (null nếu rỗng) · `min(field)` ·
`max(field)` · `countBy(fieldOrFn)` · `keyBy(fieldOrFn)`.

**Nhóm:** `groupBy(fieldOrFn, { as? })` → `GroupedFrame`:

- `.agg({ tên_cột: AggSpec })` — `AggSpec` = `["count"]` |
  `["sum"|"avg"|"min"|"max", field]` | `(rows) => unknown`
- `.count()` / `.sum(field, as?)` / `.avg(field, as?)`
- `.frames()` → `Map<string, DataFrame>`

**Join:** `leftJoin(other, leftKey, rightKey?, { prefix? })` — không khớp
giữ nguyên row; cột trùng tên không ghi đè.

Helper: `matchesOperator(value, operator, target?)` — cùng logic filter,
dùng độc lập được.

## Dashboard & SQL

Chi tiết và các bẫy: [11 — Truy vấn SQL & dashboard](11-truy-van-sql-dashboard.md).

**`DashboardsApi`** (`erp.dashboards`)

| Method | Mô tả |
| --- | --- |
| `sql(sql, { params?, values? })` | Chạy SQL không lưu (`POST /dashboards/queries/preview`) → `QueryResult`. Cũng là `erp.sql(...)` |
| `list({ page?, perPage? })` | `{ dashboards, meta }` — `meta` = `PageMeta`; server phân trang **trước** khi lọc quyền nên trang ngắn ≠ hết |
| `listAll({ perPage? })` | `DashboardDto[]` — đi hết theo `meta.totalPages` |
| `get(id)` · `create({ name, description? })` · `handle(nameOrId)` | Lấy/tạo/resolve theo tên (id → tên → tên không phân biệt hoa thường) |

**`DashboardHandle`** — `id`, `name`, `meta`

| Method | Mô tả |
| --- | --- |
| `queries(refresh?)` · `query(nameOrId)` | Query đã lưu; sai tên → `UnknownQueryError.known` |
| `run(nameOrId, params?)` | Chạy query đã lưu → `QueryResult`; tham số thiếu thì dùng `default` |
| `toFrame(nameOrId, params?)` | `run` rồi `.toFrame()` |
| `addQuery(spec)` · `updateQuery(nameOrId, changes)` · `deleteQuery(nameOrId)` | `spec` = `{ name, sql, params?, chartType?, chartConfig? }` |
| `update({ name?, description? })` · `delete()` · `refresh()` | Xoá dashboard là xoá mọi query trong đó |
| `sharing()` · `setSharing(visibility, entries?)` | `"workspace" \| "restricted"`; entries chỉ nhận khi `restricted` |

**`QueryResult`** — `columns`, `rows`, `rowCount`, `truncated`, `compiledSql?`,
`toArray()`, `toFrame()`, `column(name)`, `value(column?)`.

| Export | Mô tả |
| --- | --- |
| `assertSelectStatement(sql)` | Một câu, bắt đầu bằng `SELECT`/`WITH` — sai → `SqlQueryError` (SDK tự gọi trước mỗi request) |
| `quoteIdentifier(name)` | `Đơn hàng` → `"Đơn hàng"` |
| `MAX_QUERY_ROWS` · `MAX_QUERY_PARAMS` | 1 000 · 20 |
| `QUERY_SYSTEM_COLUMNS` · `WORKSPACE_ID_PARAM` | `id`/`created_at`/`updated_at` · `@workspace_id` |
| `CHART_TYPES` | 14 kiểu biểu đồ của query đã lưu |

## Workflow

Chi tiết: [12 — Workflow](12-workflow.md).

**`WorkflowsApi`** (`erp.workflows`)

| Method | Mô tả |
| --- | --- |
| `list({ limit?, offset? })` | `WorkflowDto[]`, mới nhất trước — **không kèm `code`** |
| `listAll({ pageSize?, maxPages? })` | Đi hết offset cho tới trang ngắn/rỗng |
| `get(id)` | Định nghĩa đầy đủ kèm `code` |
| `create(spec)` | `{ name, code, trigger, description?, env? }` → `WorkflowHandle` ở trạng thái **draft** |
| `handle(nameOrId)` | Resolve theo tên như object → `WorkflowHandle` |

**`WorkflowHandle`** — `id`, `name`, `version`, `status`, `isPublished`,
`trigger`, `code`, `envNames`, `meta`

| Method | Mô tả |
| --- | --- |
| `update(changes)` | `{ name?, description?, trigger?, code?, version? }`; thiếu `version` thì lấy của handle. Mọi thay đổi đưa workflow **về draft** |
| `publish(version?)` | Draft → active |
| `setEnv(env)` | **Thay cả map**; `WORKFLOW_ENV_KEEP` (`"[KEEP]"`) giữ giá trị không đọc lại được; ≤ 50 entry |
| `run(input?, { dryRun? })` | Đưa vào hàng đợi → `WorkflowRunDto` (`ENQUEUED`). Ở chế độ development ném `DryRunUnsupportedError` |
| `waitForRun(runId, { timeoutMs?, intervalMs?, throwOnError? })` | Poll đến khi xong; `ERROR` → `WorkflowRunFailedError`, hết giờ → `WorkflowRunTimeoutError` (run **vẫn chạy**) |
| `runAndWait(input?, options?)` | `run` + `waitForRun` |
| `runs({ limit?, offset? })` · `getRun(runId)` | Lịch sử run |
| `sharing()` · `setSharing(visibility, entries?)` · `delete(version?)` · `refresh()` | |

| Export | Mô tả |
| --- | --- |
| `runOutput(run)` | Parse `run.output` (chuỗi JSON) → `{ workflowId, version, result, logs, durationMs }` |
| `runResult(run)` · `runLogs(run)` | Lối tắt lấy giá trị `main()` trả về / các dòng log |
| `isRunFinished(status)` · `WORKFLOW_RUN_PENDING_STATUSES` | `ENQUEUED` · `PENDING` là chưa xong; `SUCCESS` · `ERROR` là xong |
| `WORKFLOW_TRIGGER_TYPES` | `manual`, `cron` — chỉ có hai |
| `assertWorkflowTrigger` · `assertWorkflowCode` · `assertWorkflowEnv` | Kiểm phía client → `WorkflowDefinitionError` |
| `WORKFLOW_ENV_KEEP` · `MAX_WORKFLOW_ENV_ENTRIES` | `"[KEEP]"` · 50 |

## Web app helpers (browser)

| Export | Mô tả |
| --- | --- |
| `readInitDataFromLocation(location?)` | Đọc initData từ `#erpInitData=` hoặc `?erpInitData=` → `string \| undefined` |
| `receiveInitData({ allowedOrigins, timeoutMs? })` | Promise chờ postMessage `{ type: "erp-miniapp:init-data", initData }`. Bắt buộc origin cụ thể — rỗng hoặc `"*"` → reject |
| `sendInitDataToFrame(target, initData, targetOrigin)` | (App chủ) đưa initData vào frame. `targetOrigin = "*"` → throw |
| `parseInitData(initData)` | `InitDataUnsafe { user?, workspaceId?, serviceAccountId?, authDate?, hash? }` — **chưa xác minh, chỉ để hiển thị** |
| `INIT_DATA_MESSAGE_TYPE` | `"erp-miniapp:init-data"` |
| `INIT_DATA_URL_PARAM` | `"erpInitData"` |

## Errors

| Class | Khi nào | Thuộc tính thêm |
| --- | --- | --- |
| `ErpApiError` | Mọi response non-2xx | `status`, `trace?`, `details?` |
| `MissingPermissionsError` | Key thiếu quyền đã khai | `missing: RequiredPermission[]` |
| `SchemaMismatchError` | `assertSchema` thấy workspace chưa khớp `schema.json` | `missing: SchemaGap[]`, `conflicts: SchemaGap[]` |
| `UnknownObjectError` | `object(name)` không khớp | `object` |
| `UnknownFieldError` | Tên field không khớp | `field`, `objectName`, `known: string[]` |
| `FilterValueError` | `in`/`not_in` nhận giá trị server sẽ từ chối (không phải mảng, rỗng, > 200) | `field`, `operator`, `reason` |
| `RelationValueError` | Field `relation` nhận thứ không phải mảng ≤ 100 record id | `field`, `reason` |
| `DryRunUnsupportedError` | Gọi `delete`/`restore`/`createLink`/`deleteLink`/`workflow.run()` khi client đang ở chế độ development | `operation` |
| `UnknownWorkflowError` · `UnknownDashboardError` | Tên/id không khớp | `workflow` / `dashboard`, `known: string[]` |
| `UnknownQueryError` | Query đã lưu không có trên dashboard đó | `query`, `dashboard`, `known` |
| `WorkflowDefinitionError` | Trigger lạ, cron thiếu giây/timezone, code không có `main()`, tên env sai | `field: "trigger" \| "code" \| "env"`, `reason` |
| `WorkflowRunFailedError` | Run kết thúc ở `ERROR` | `workflow`, `run` (`run.error` = message script throw + log) |
| `WorkflowRunTimeoutError` | Hết `timeoutMs` mà run chưa xong — **run không bị huỷ** | `workflow`, `run`, `timeoutMs` |
| `SqlQueryError` | SQL không phải một câu `SELECT` duy nhất | `reason` |

Mã lỗi hay gặp trong `ErpApiError.status`: 401 (key/token/initData sai hoặc
hết hạn), 403 (thiếu permission RBAC), 404 (không tồn tại *hoặc* bị ACL ẩn),
409 (version lệch / trạng thái không cho phép), 422/400 (dữ liệu sai).

## HTTP tầng thấp

```ts
import { FetchHttp, API_KEY_PREFIX } from "erp-sdk";

const http = new FetchHttp({ baseUrl, apiKey, workspaceId?, accessToken?, fetch? });
await http.request<T>(method, path, { body?, query? });
```

- Base = `baseUrl` + `/api/v1`; headers tự gắn: `X-API-Key` hoặc
  `Authorization: Bearer`, `X-Workspace-Id` nếu có, `Content-Type: application/json`.
- Response envelope `{ success, message, statusCode, data, trace? }` được
  bóc sẵn — trả thẳng `data`; non-2xx → `ErpApiError`.
- `requestPaged<T>(...)` trả `{ data, meta }`, giữ lại `meta` của envelope
  (`PageMeta`) cho các endpoint phân trang theo số trang.
- Interface `Http { request<T>(...); requestPaged?<T>(...) }` — chỉ `request`
  là bắt buộc, nên mock trong test không phải đụng tới.

## Types chính

`Envelope<T>` · `Resource` (`"object"`, `"object:record"`, `"workflow"`, … +
string tuỳ ý) · `Action` (`"create" | "read" | "update" | "delete" | "manage"
| "*"` + tuỳ ý) · `RequiredPermission` · `PermissionDto` · `ObjectDto` ·
`FieldDto` · `RecordDto` · `RecordPage` · `RecordFilter` · `RecordSort` ·
`RecordPreload` · `QueryRecordsRequest` · `BulkCreateRecordsRequest` ·
`BulkCreateRecordsResult` · `BulkUpdateRecordsRequest` ·
`BulkUpdateRecordsResult` · `CreateRecordRequest` · `UpdateRecordRequest` ·
`ErpMode` · `WriteOptions` · `VersionedWriteOptions` · `LinkDirection` · `UserDto` · `MiniAppInitData` ·
`MiniAppSessionDto` · `EnsureFieldSpec` · `Row` · `AggSpec` · `MiniAppSchema` ·
`SchemaObjectSpec` · `SchemaFieldSpec` · `SchemaStatus` · `SchemaAction` ·
`SchemaObjectPlan` · `SchemaFieldPlan` · `MiniAppSchemaPlan` (body của
`GET /mini-apps/:id/schema`) · `WorkspaceObjectShape` · `SchemaGap` ·
`FieldType` · `DeclarableFieldType` · `PageMeta` · `Paged` ·
`WorkflowDto` · `WorkflowTrigger` · `WorkflowTriggerType` · `CronTriggerConfig` ·
`WorkflowStatus` · `WorkflowRunDto` · `WorkflowRunStatus` · `WorkflowRunOutput` ·
`WorkflowSpec` · `WorkflowChanges` · `WaitForRunOptions` · `DashboardDto` ·
`DashboardQueryDto` · `QueryResultDto` · `QueryParamSpec` · `QueryParamType` ·
`QuerySpec` · `QueryChanges` · `SqlOptions` · `ChartType` · `SharingDto` ·
`SharingEntry` · `SharingVisibility` · `SharingAccess` · `SharingSubjectType`.

Chi tiết từng field: xem `src/types.ts` (được ship kèm `.d.ts`).

---

[← Triển khai](07-trien-khai-van-hanh.md) · [Mục lục](README.md) · [Tiếp: Tutorial →](09-tutorial-leave-request.md)
