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
  fetch?: typeof fetch;               // custom fetch (test/proxy)
}
```

Throw nếu không có `apiKey` lẫn `accessToken`. SDK không kiểm tra prefix của
key — key sai/hết hạn sẽ lộ ra ở request đầu tiên dưới dạng `ErpApiError` 401.
(`API_KEY_PREFIX = "erp_sk_"` vẫn export để tham chiếu, không còn dùng để
validate.)

## ErpClient

| Method | Mô tả |
| --- | --- |
| `me(refresh?)` | `UserDto` của actor hiện tại (service account hoặc user). Cache; `refresh: true` để nạp lại |
| `asUser(accessToken, workspaceId?)` | Client mới hành động dưới quyền user (JWT). Chỉ dùng được trên client tạo bởi `createMiniApp` |
| `session(initData)` | Đổi initData → `{ user: UserDto, client: ErpClient, expiresIn: number }`. `client` mang quyền user |
| `issueInitData(serviceAccountId)` | (Phía app chủ) mint initData cho user hiện tại → `{ initData, expiresIn }` |
| `objects(refresh?)` | `ObjectDto[]` mọi object trong workspace. Cache |
| `object(nameOrId)` | `ObjectHandle` — resolve theo id, tên, tên không phân biệt hoa thường. Không thấy → `UnknownObjectError`. Cache |
| `hasObject(nameOrId)` | `boolean` |
| `createObject(name, { position? })` | Tạo object mới → handle |
| `ensureObject(name, fields?)` | Idempotent: lấy hoặc tạo object, thêm field còn thiếu (`EnsureFieldSpec[]`) |
| `deleteObject(nameOrId)` | Xoá object |
| `myPermissions(refresh?)` | `PermissionDto[]` hiệu lực. Cache |
| `can(resource, action)` | `boolean` — deny thắng allow, `*` wildcard |
| `assertPermissions(extra?)` | Verify quyền khai lúc tạo + `extra`; thiếu → `MissingPermissionsError` |
| `invalidate()` | Xoá mọi cache (permissions, objects, me, handles) |
| `http` | `Http` — gọi endpoint tuỳ ý: `app.http.request<T>("GET", "/users/me")` |

## ObjectHandle

Thuộc tính: `id`, `name`, `meta: ObjectDto`, `fields: FieldDto[]`.

**Schema:**

| Method | Mô tả |
| --- | --- |
| `field(nameOrKey)` | `FieldDto` — không thấy → `UnknownFieldError` (`.known` = danh sách field) |
| `fieldKey(nameOrKey)` | key nội bộ của field |
| `addField(name, type, { config?, position? })` | Thêm field |
| `updateField(nameOrKey, { name?, config?, position?, isArchived? })` | Sửa field |
| `rename(name)` | Đổi tên object |

**Record:** (mọi key data nhận tên hiển thị hoặc key)

| Method | Mô tả |
| --- | --- |
| `create(data)` | Tạo record → `RecordDto` |
| `get(recordId)` | Lấy một record |
| `update(recordId, data, version?)` | Sửa; không truyền `version` thì tự GET lấy (thêm 1 request). Version lệch → 409 |
| `delete(recordId, version?)` | Soft delete |
| `restore(recordId, version)` | Khôi phục |
| `records()` | Mở `RecordQuery` |
| `rowFromRecord(record, by = "name")` | Record → object phẳng theo tên/key field, kèm `id`, `version`, `createdAt`, `updatedAt`, merge `computedData` |

**Links (field `relation`):**

| Method | Mô tả |
| --- | --- |
| `createLink(recordId, field, targetRecordId, position = 0)` | Nối record |
| `listLinks(recordId, field, direction = "outgoing")` | Liệt kê (`"outgoing"` \| `"incoming"`) |
| `deleteLink(recordId, field, targetRecordId)` | Gỡ nối |

## RecordQuery

Builder bất biến về mặt sử dụng — mỗi method trả `this`, kết thúc bằng một
lệnh thực thi:

```ts
q.where(field, operator, value?)   // AND; tối đa 20 (server)
 .orderBy(field, "asc" | "desc")   // tối đa 3
 .limit(n)                         // tối đa 100/trang
 .cursor(cursor)                   // phân trang
 .withTotal()                      // đếm tổng (thêm chi phí)
```

| Thực thi | Trả về |
| --- | --- |
| `fetch()` | `RecordPage = { records, nextCursor?, hasMore, total? }` |
| `fetchAll({ max? })` | `RecordDto[]` — tự lặp cursor (100/trang) đến hết hoặc `max` |
| `first()` | `RecordDto \| undefined` |
| `count()` | `number` (dùng `withTotal` ngầm) |
| `toFrame({ by?, max? })` | `DataFrame<Row>` — cột theo `"name"` (mặc định) hoặc `"key"` |
| `build()` | `QueryRecordsRequest` thô (tự gọi API) |

`FilterOperator`: `equals` · `not_equals` · `contains` · `greater_than` ·
`greater_than_or_equal` · `less_than` · `less_than_or_equal` · `is_empty` ·
`is_not_empty`.

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
| `UnknownObjectError` | `object(name)` không khớp | `object` |
| `UnknownFieldError` | Tên field không khớp | `field`, `objectName`, `known: string[]` |

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
- Interface `Http { request<T>(...) }` — implement để mock trong test.

## Types chính

`Envelope<T>` · `Resource` (`"object"`, `"object:record"`, `"workflow"`, … +
string tuỳ ý) · `Action` (`"create" | "read" | "update" | "delete" | "manage"
| "*"` + tuỳ ý) · `RequiredPermission` · `PermissionDto` · `ObjectDto` ·
`FieldDto` · `RecordDto` · `RecordPage` · `RecordFilter` · `RecordSort` ·
`QueryRecordsRequest` · `LinkDirection` · `UserDto` · `MiniAppInitData` ·
`MiniAppSessionDto` · `EnsureFieldSpec` · `Row` · `AggSpec`.

Chi tiết từng field: xem `src/types.ts` (được ship kèm `.d.ts`).

---

[← Triển khai](07-trien-khai-van-hanh.md) · [Mục lục](README.md) · [Tiếp: Tutorial →](09-tutorial-leave-request.md)
