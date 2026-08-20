# erp-sdk — API surface

Node 18+ (uses global `fetch`). ESM + CJS. `import { … } from "erp-sdk"`.
No runtime dependencies except lodash.

## Initialization

```ts
createMiniApp(config): Promise<ErpClient>
// config: { baseUrl, apiKey?, accessToken?, workspaceId?, permissions?,
//           mode?, env?, fetch? }
```

Requires `apiKey` (`erp_sk_…` service account or `erp_uk_…` user key) **or**
`accessToken` (user JWT). API key auto-pins its workspace — only pass
`workspaceId` when using `accessToken`. With `permissions`, SDK calls
`/iam/me/permissions` during initialization and throws `MissingPermissionsError` listing
exact `resource:action` pairs that are missing.

The function is named `createMiniApp` for historical reasons (SDK was built for mini apps),
but it's the universal factory for any client — analysis scripts, sync jobs, internal CLIs all use it.

Custom `fetch` can be passed → testing without network.

## Run mode (`ERP_ENV`)

```ts
type ErpMode = "production" | "development";
resolveMode(env?): ErpMode        // read ERP_ENV; unset → "production"
isDryRunMode(mode): boolean
ERP_ENV_VAR                        // "ERP_ENV"
```

`ERP_ENV=development` (aliases: `dev`, `dry-run`) makes **all record write commands**
default to `dryRun: true`; `production` (aliases `prod`, `live`) or unset means write for real.
Unknown values → error, no guessing. `NODE_ENV` is deliberately **not** read.
`config.mode` overrides env; `config.env` specifies where to read the variable (useful for testing).

Server executes the real statement then rolls back: errors are identical, success leaves no
record/link/event and `version` doesn't increment. **IDs returned from dry-run create
are fake, never persisted.**

Dry run only exists for `create`, `createMany`, `update`, `updateWhere`. `delete`,
`restore`, `createLink`, `deleteLink` throw `DryRunUnsupportedError` when client
is in development; changing table structure always runs for real.

## ErpClient

| Method | Notes |
| --- | --- |
| `mode` · `dryRun` | Current mode and whether writes are dry runs (properties) |
| `production()` · `development()` · `withMode(mode)` | Same credentials, different mode — separate cache so objects/fields re-fetched |
| `objects(refresh?)` | `ObjectDto[]` — id, name, position (cached) |
| `object(nameOrId)` | `ObjectHandle`; resolves id → exact name → case-insensitive name, cached by both keys |
| `hasObject(nameOrId)` | boolean, doesn't throw |
| `me(refresh?)` | Current user — service account keys **don't have** `/users/me`, will throw |
| `myPermissions(refresh?)` | Effective `PermissionDto[]`, cached |
| `can(resource, action)` | Preflight; deny wins over allow, `manage` doesn't imply other actions |
| `assertPermissions(extra?)` | Throws `MissingPermissionsError` if missing (refreshes cache first) |
| `asUser(accessToken, workspaceId?)` | New client running under that user's permissions + row scope |
| `session(initData)` | Trade signed initData → `{ user, client, expiresIn }` |
| `issueInitData(serviceAccountId)` | Host-side: issue initData string (→ skill `erp-miniapp`) |
| `assertSchema(schema, { refresh? })` | Match `schema.json` → `Record<table name, ObjectHandle>` (→ skill `erp-miniapp`) |
| `schemaPlan(schema, { refresh? })` | Diff like review UI, doesn't throw → `SchemaObjectPlan[]` |
| `createObject(name, { position? })` | **Needs admin key** — `member` service account gets 403 |
| `ensureObject(name, fields[])` | Idempotent create table + missing fields (admin key) |
| `deleteObject(nameOrId)` | Delete table and its records (admin key) |
| `invalidate()` | Clear all caches (objects, fields, permissions, me) |

After changing structure (adding fields, renaming tables) call `invalidate()` or
`objects(true)`, otherwise handle cache keeps the old schema.

## ObjectHandle

Properties: `id`, `name`, `meta` (`ObjectDto`), `fields` (`FieldDto[]`).

| Method | Notes |
| --- | --- |
| `field(nameOrKey)` | `FieldDto`; wrong → `UnknownFieldError` with `.known` |
| `hasField(nameOrKey)` | boolean, doesn't throw |
| `fieldKey(nameOrKey)` | Field's internal key |
| `records()` | New `RecordQuery` |
| `get(id)` | `RecordDto` |
| `getMany(ids, { chunkSize? })` | 1 request/200 ids, preserves input order; ids blocked by row scope or deleted are absent (no error) |
| `create(data, { dryRun? })` | Keys by display name **or** field key |
| `createMany(rows, { chunkSize?, dryRun? })` | Bulk insert, auto-chunks into ≤500; each chunk is all-or-nothing transaction |
| `update(id, data, version \| { version?, dryRun? })` | Omit version to `get` first; version mismatch → 409 |
| `updateWhere(filters, data, { limit?, dryRun? })` | Bulk update by filter (use internal keys) |
| `delete(id, version \| { version?, dryRun? })` | Soft delete — no dry run |
| `restore(id, version)` | Restore — no dry run |
| `related(record, field)` | `preload`-ed record → `RecordDto[]` |
| `linkedIds(record, field)` | Array of ids in `data` of `relation` field (record must be from query, not `get`) |
| `rowFromRecord(record, by?)` | `RecordDto` → flat row; `by = "name"` (default) or `"key"` |
| `listLinks` · `createLink` · `deleteLink` | Modify links individually — only needed for relations > 100 ids |
| `addField` · `updateField` · `rename` | **Admin key** — change table structure |

Field types: `text`, `long_text`, `number`, `currency`, `percent`, `checkbox`,
`date`, `datetime`, `single_select`, `multi_select`, `url`, `email`, `phone`,
`relation`, `lookup`, `rollup`, `formula`, `attachment`.

`rowFromRecord` returns `id`, `version`, `createdAt`, `updatedAt` plus all values
from `data` + `computedData`, columns named by display name.

### `relation` fields in `data`

Write like regular fields, value is **array of record ids** in display order —
same transaction as the whole row, no `createLink` needed after.

| What you send | Meaning |
| --- | --- |
| key not present | links stay as-is |
| `null` | **same as not sending key** — links stay as-is (unlike regular fields: `null` means delete value) |
| `[a, b]` | links become **exactly** a, b; old links disappear |
| `[]` | clear all links for this field |

Max `MAX_RELATION_IDS` = **100 ids / field / record** (read and write), 20,000 links / request.
Longer than 100 cannot be inline-edited — use `createLink`/`deleteLink`. SDK throws `RelationValueError`
before network call if array > 100, elements aren't ids (e.g., passing entire `RecordDto`), or value isn't an array.
One bad id (doesn't exist, wrong target table, self-links) breaks **the entire request**, including bulk operations.

Reading: `POST /records/query` returns **all** outgoing relation fields as id arrays
(empty if no links); create/update return only fields just written; `get(id)`
**doesn't** return relations.

## RecordQuery (chainable, stateful)

```ts
.where(field, operator, value?)      // max 20 filters
.whereIn(field, values) / .whereNotIn(field, values)
.whereIds(ids)                        // filter by record's own ids
.orderBy(field, "asc" | "desc")       // max 3
.preload(field, { limit?, direction? })   // max 10, avoid N+1
.limit(n)                             // server max 100
.cursor(c) .withTotal()
.build()                              // see the request body (debug)

await .fetch()                        // { records, nextCursor, hasMore, total? }
await .fetchAll({ max? })             // auto-paginate to cursor end, 100/page
await .first()                        // set limit(1)
await .count()                        // set limit(1).withTotal()
await .update(data, { limit?, dryRun? })  // bulk update all matching rows
await .toFrame({ by?, max? })         // fetchAll + rowFromRecord → DataFrame
```

`first()` and `count()` **mutate the query** (`limit`) — build new chain each call
instead of reusing.

Operators (`FilterOperator`): `equals`, `not_equals`, `contains`, `in`, `not_in`,
`greater_than`, `greater_than_or_equal`, `less_than`, `less_than_or_equal`,
`is_empty`, `is_not_empty`. `in`/`not_in` take arrays of 1..200 values (`MAX_FILTER_VALUES`),
bad shape → `FilterValueError` **before** network call. `not_in` also matches records without a value (server-matching).

`preload(field)`: name of `relation` field on this table (n-1), or
`FieldDto` from another table pointing to this one (1-n) — direction auto-inferred, read results with `handle.related(record, field)`.

Bulk update: ≤5,000 rows/call, returns `{ matched, updated, hasMore, dryRun? }`;
`unique` fields can't be set via bulk; computed fields auto-recalculated by worker. Patch applies to **all** matching rows, so relations in patch override each row's list —
`{ "Line Items": [] }` clears links on up to 5,000 records in one call. Run
`{ dryRun: true }` to get real `matched` count before doing it.

## DataFrame

Immutable — every method returns a new frame. Columns = **display names** of fields, plus `id`,
`version`, `createdAt`, `updatedAt`, and computed columns.

| Group | Methods |
| --- | --- |
| Select rows | `filter`, `where(field, op, value)`, `head`, `tail`, `slice`, `unique`, `uniqueBy` |
| Select columns | `select`, `rename`, `pluck`, `map` |
| Sort | `sortBy(fields, directions)` |
| Aggregate | `sum`, `avg`, `min`, `max`, `count`, `isEmpty`, `countBy`, `keyBy` |
| Group | `groupBy(field \| fn, { as? })` → `.agg({})`, `.count()`, `.sum(f, as?)`, `.avg(f, as?)`, `.frames()` |
| Join | `leftJoin(other, leftKey, rightKey?, { prefix? })` |
| Extract | `toArray`, `first`, `last`, `at`, `forEach` |

`agg` accepts `["count"]`, `["sum"\|"avg"\|"min"\|"max", column]`, or a function
`(rows) => value`. Non-numeric values coerce to numbers (unparseable strings → `0`), so
money/number columns must be clean before `sum`.

`where` on frames uses the same operators as the server (`matchesOperator` is also
exported if you need to use it separately).

## SQL & dashboards

```ts
erp.sql(sql, { params?, values? }): Promise<QueryResult>   // = erp.dashboards.sql(...)
```

`QueryResult`: `columns`, `rows`, `rowCount`, `truncated`, `compiledSql?`,
`toArray()`, `toFrame()`, `column(name)`, `value(column?)`.

| Export | Notes |
| --- | --- |
| `erp.dashboards.list({ page?, perPage? })` | `{ dashboards, meta }`; `meta.totalItems` includes hidden ones |
| `erp.dashboards.listAll({ perPage? })` | Walk all pages per `meta.totalPages` — use this one |
| `erp.dashboards.create({ name, description? })` · `erp.dashboard(nameOrId)` | Create / resolve by name |
| `dash.queries(refresh?)` · `dash.query(nameOrId)` | Saved queries; wrong name → `UnknownQueryError.known` |
| `dash.run(nameOrId, params?)` · `dash.toFrame(nameOrId, params?)` | Run saved query |
| `dash.addQuery({ name, sql, params?, chartType?, chartConfig? })` | `chartType` ∈ `CHART_TYPES` (14 types) |
| `dash.updateQuery(nameOrId, changes)` · `dash.deleteQuery(nameOrId)` | |
| `dash.update({ name?, description? })` · `dash.delete()` | Delete dashboard = delete all queries |
| `dash.sharing()` · `dash.setSharing(visibility, entries?)` | `"workspace" \| "restricted"` |
| `assertSelectStatement(sql)` · `assertQueryParams(params)` · `quoteIdentifier(name)` | Validate SQL / param count / quote display name |
| `MAX_QUERY_ROWS` (1000) · `MAX_QUERY_PARAMS` (20) · `QUERY_SYSTEM_COLUMNS` · `WORKSPACE_ID_PARAM` | Limits & constants |

Parameters: `params: [{ name, type: "text"|"number"|"boolean"|"date"|"datetime",
label?, default? }]`, values passed via `values` (ad-hoc) or second arg
of `dash.run` (saved queries). Syntax details: `references/sql.md`.

## Workflows

`erp.workflows` / `erp.workflow(nameOrId)` — server-side scripts running on
`manual` or `cron` trigger. Full surface, draft/publish lifecycle, write-only env, how to read run results: **`references/workflows.md`**.

## Permissions

```ts
isAllowed(permissions, resource, action): boolean
missingPermissions(permissions, required): RequiredPermission[]
```

Mirror of the backend enforcer: deny beats allow, `*` is wildcard, `manage` doesn't imply other actions.

## HTTP

`FetchHttp` auto-adds `/api/v1`, sets `X-API-Key` or `Authorization: Bearer`, unwraps
`{ success, data, message, trace }`, throws `ErpApiError` on non-2xx.
Access directly via `client.http.request(method, path, { body, query })` when needing
an SDK-unwrapped endpoint; `requestPaged(...)` returns `{ data, meta }` when you need the full `meta` pagination.

## Errors

| Class | Useful fields |
| --- | --- |
| `MissingPermissionsError` | `.missing` |
| `UnknownObjectError` | `.object` |
| `UnknownFieldError` | `.field`, `.objectName`, `.known` |
| `FilterValueError` | `.field`, `.operator` |
| `RelationValueError` | `.field`, `.reason` |
| `DryRunUnsupportedError` | `.operation` |
| `SchemaMismatchError` | `.missing`, `.conflicts` (`{ object, field?, type?, currentType? }`) |
| `SqlQueryError` | `.reason` |
| `UnknownWorkflowError` · `UnknownDashboardError` | `.workflow` / `.dashboard`, `.known` |
| `UnknownQueryError` | `.query`, `.dashboard`, `.known` |
| `WorkflowDefinitionError` | `.field` (`trigger`\|`code`\|`env`), `.reason` |
| `WorkflowRunFailedError` | `.workflow`, `.run.error` |
| `WorkflowRunTimeoutError` | `.workflow`, `.run`, `.timeoutMs` — run **still running** |
| `ErpApiError` | `.status`, `.trace`, `.details` |

## Not covered by this skill

`schema.json` (`validateSchema`, `planSchema`, `assertSchema`, `schemaConflicts`,
`unresolvedRelations`…) and browser-side initData bridge (`readInitDataFromLocation`,
`receiveInitData`, `parseInitData`, `sendInitDataToFrame`) support **building
mini apps** — see skill **`erp-miniapp`**.

`erp.asUser(accessToken)` and `erp.session(initData)` can still be used from here when
you need to run as a specific user (see the `ErpClient` table above).
