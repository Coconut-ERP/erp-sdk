# erp-sdk data API

## Contents

- [Client](#client)
- [Run mode](#run-mode)
- [ObjectHandle](#objecthandle)
- [Relation fields](#relation-fields)
- [RecordQuery](#recordquery)
- [DataFrame](#dataframe)
- [SQL and dashboards](#sql-and-dashboards)
- [Permissions and raw HTTP](#permissions-and-raw-http)
- [Errors](#errors)

## Client

```ts
createMiniApp({ baseUrl, apiKey?, accessToken?, workspaceId?, permissions?, mode?, env?, fetch? }): Promise<ErpClient>
```

The factory for every client — scripts and jobs as much as mini apps. Pass `apiKey`
(`erp_sk_…` service account, `erp_uk_…` personal key) or `accessToken` (a user JWT,
with `workspaceId`; an API key already pins its workspace). `permissions` checks
`/iam/me/permissions` and throws `MissingPermissionsError` with the missing pairs.
`fetch` injects a transport for tests.

| Member | Notes |
| --- | --- |
| `mode` · `dryRun` | Current mode, and whether record writes are dry runs |
| `production()` · `development()` · `withMode(mode)` | Same credentials, other mode, separate caches |
| `objects(refresh?)` | `ObjectDto[]` (cached) |
| `object(nameOrId)` | `ObjectHandle`; resolves id → exact name → case-insensitive name |
| `hasObject(nameOrId)` | Boolean, never throws |
| `me(refresh?)` | Current user — throws for a service-account key |
| `myPermissions(refresh?)` · `can(resource, action)` | Effective rules; deny beats allow, `manage` implies nothing else |
| `assertPermissions(extra?)` | Throws `MissingPermissionsError` |
| `asUser(accessToken, workspaceId?)` | Client bound by that user's permissions and row scope |
| `session(initData)` | `{ user, client, expiresIn }` — skill `erp-miniapp` |
| `assertSchema(schema)` · `schemaPlan(schema)` | Check a `schema.json` — skill `erp-miniapp` |
| `createObject(name, { groups?, position? })` · `ensureObject(name, fields)` · `deleteObject(nameOrId)` | **Admin key**; a `writer` gets 403 |
| `invalidate()` | Drop every cache (objects, fields, permissions, me) |

## Run mode

`ERP_ENV` is read once, at construction: `development` (`dev`, `dry-run`) or
`production` (`prod`, `live`, or unset). Any other value throws; `NODE_ENV` is never
read. `config.mode` overrides it, `config.env` supplies the variables to read.
`resolveMode(env?)` and `isDryRunMode(mode)` expose the same logic.

In development, `create`, `createMany`, `update` and bulk update default to
`dryRun: true`: the server runs the statement and rolls back — identical errors, no
record, link or event, no version bump, fake ids. `delete`, `restore`, `createLink`
and `deleteLink` throw `DryRunUnsupportedError`. Every write takes `{ dryRun }` to
override one call. Definition changes always write for real.

## ObjectHandle

Properties: `id`, `name`, `groups`, `meta` (`ObjectDto`), `fields` (`FieldDto[]`).

| Method | Notes |
| --- | --- |
| `field(nameOrKey)` · `hasField` · `fieldKey` | Unknown → `UnknownFieldError` with `.known` |
| `records()` | New `RecordQuery` |
| `get(id)` | `RecordDto`, **without** relations |
| `getMany(ids, { chunkSize? })` | 200 ids per request, input order kept; hidden or deleted ids are simply absent |
| `create(data, { dryRun? })` | Keys by display name or field key |
| `createMany(rows, { chunkSize?, dryRun? })` | Chunks of ≤ 500, each all-or-nothing |
| `update(id, data, version \| { version?, dryRun? })` | Reads the version when omitted; mismatch → 409 |
| `updateWhere(filters, data, { limit?, dryRun? })` | Bulk update by raw filters (field keys) |
| `delete(id, version \| { version? })` · `restore(id, version)` | Soft delete; no dry run |
| `related(record, field)` | Preloaded records → `RecordDto[]` |
| `linkedIds(record, field)` | Ids in a `relation` field of a queried record |
| `rowFromRecord(record, by?)` | Flat row: `id`, `version`, `createdAt`, `updatedAt`, `data` and `computedData`, by display name (default) or `"key"` |
| `listLinks` · `createLink` · `deleteLink` | One link at a time — only for relations over 100 ids |
| `addField` · `updateField` | **Admin key** |
| `updateDefinition({ name?, groups?, position? })` · `rename` · `setGroups` | **`object:update`**; `groups` replaces the list (≤ 10); refreshes the client's caches |

Field types: `text`, `long_text`, `number`, `currency`, `percent`, `checkbox`, `date`,
`datetime`, `single_select`, `multi_select`, `url`, `email`, `phone`, `relation`,
`lookup`, `rollup`, `formula`, `attachment`.

## Relation fields

A `relation` value is an array of record ids, in display order, written in the same
transaction as the rest of the row.

| Sent | Result |
| --- | --- |
| Key absent, or `null` | Links unchanged |
| `[a, b]` | Links become exactly `a`, `b` |
| `[]` | All links on that field removed |

- At most **100 ids per field per record**, reading and writing; beyond that use
  `createLink` / `deleteLink`. At most 20,000 links per request.
- The SDK throws `RelationValueError` before sending when the array is too long, is
  not an array, or holds something other than ids (a whole `RecordDto`, say).
- One bad id — missing, wrong target table, a self-link — fails the whole request,
  bulk calls included.
- A query returns every outgoing relation as an id array; `create` / `update` return
  only the fields they wrote; `get(id)` returns none.
- In a bulk update the patch applies to every matched row, so
  `{ "Line Items": [] }` clears links on up to 5,000 records at once.

## RecordQuery

```ts
.where(field, operator, value?)          // ≤ 20 filters
.whereIn(field, values) · .whereNotIn(field, values)
.whereIds(ids)
.orderBy(field, "asc" | "desc")          // ≤ 3
.preload(field, { limit?, direction? })  // ≤ 10
.limit(n)                                // ≤ 100
.cursor(c) · .withTotal() · .build()     // build() shows the request body

await .fetch()                           // { records, nextCursor, hasMore, total? }
await .fetchAll({ max? })                // follows the cursor; no default cap
await .first() · .count()                // both change the query's limit
await .update(data, { limit?, dryRun? }) // ≤ 5,000 rows → { matched, updated, hasMore, dryRun? }
await .toFrame({ by?, max? })
```

Operators: `equals`, `not_equals`, `contains`, `in`, `not_in`, `greater_than`,
`greater_than_or_equal`, `less_than`, `less_than_or_equal`, `is_empty`,
`is_not_empty`. `in` / `not_in` take 1–200 values, checked before sending
(`FilterValueError`); `not_in` also matches records with no value.

`preload(field)` takes a `relation` field on this table (many-to-one) or a `FieldDto`
on another table pointing here (one-to-many); read the result with
`handle.related(record, field)`.

Bulk update cannot set `unique` fields. Run it with `{ dryRun: true }` to get the
real `matched` count first.

## DataFrame

Immutable; every method returns a new frame. Columns are display names plus `id`,
`version`, `createdAt`, `updatedAt` and computed fields.

| Group | Methods |
| --- | --- |
| Rows | `filter`, `where(field, op, value)`, `head`, `tail`, `slice`, `unique`, `uniqueBy` |
| Columns | `select`, `rename`, `pluck`, `map` |
| Sort | `sortBy(fields, directions)` |
| Aggregate | `sum`, `avg`, `min`, `max`, `count`, `isEmpty`, `countBy`, `keyBy` |
| Group | `groupBy(field \| fn, { as? })` → `agg`, `count`, `sum(f, as?)`, `avg(f, as?)`, `frames` |
| Join | `leftJoin(other, leftKey, rightKey?, { prefix? })` |
| Extract | `toArray`, `first`, `last`, `at`, `forEach` |

`agg` takes `["count"]`, `["sum" | "avg" | "min" | "max", column]` or
`(rows) => value`. Aggregates coerce to numbers, and an unparseable string counts as
`0`. `where` uses the server's operators (`matchesOperator` is exported).

## SQL and dashboards

```ts
erp.sql(sql, { params?, values? }): Promise<QueryResult>
// QueryResult: columns, rows, rowCount, truncated, compiledSql?, toArray(), toFrame(), column(name), value(column?)
```

| Member | Notes |
| --- | --- |
| `erp.dashboards.listAll({ perPage? })` | Use this — `list()` paginates before filtering by sharing |
| `erp.dashboards.create({ name, description? })` · `erp.dashboard(nameOrId)` | |
| `dash.queries(refresh?)` · `dash.query(nameOrId)` | Unknown → `UnknownQueryError` with `.known` |
| `dash.run(nameOrId, values?)` · `dash.toFrame(nameOrId, values?)` | Run a saved query |
| `dash.addQuery({ name, sql, params?, chartType?, chartConfig? })` | `chartType` ∈ `CHART_TYPES` |
| `dash.updateQuery(nameOrId, changes)` · `dash.deleteQuery(nameOrId)` | |
| `dash.update({ name?, description? })` · `dash.delete()` | Deleting a dashboard deletes its queries |
| `dash.sharing()` · `dash.setSharing(visibility, entries?)` | `"workspace"` \| `"restricted"` |
| `assertSelectStatement` · `assertQueryParams` · `quoteIdentifier` | Client-side checks |
| `MAX_QUERY_ROWS` (1000) · `MAX_QUERY_PARAMS` (20) | |

Writing the SQL itself: `sql.md`.

## Permissions and raw HTTP

`isAllowed(permissions, resource, action)` and `missingPermissions(permissions,
required)` mirror the backend: deny beats allow, `*` is a wildcard, `manage` implies
no other action.

For an endpoint the SDK does not wrap, `client.http.request(method, path, { body,
query })` adds `/api/v1` and the credential and unwraps the envelope;
`requestPaged(...)` also returns `meta`. Non-2xx throws `ErpApiError`.

## Errors

| Class | Fields |
| --- | --- |
| `MissingPermissionsError` | `.missing` |
| `UnknownObjectError` | `.object` |
| `UnknownFieldError` | `.field`, `.objectName`, `.known` |
| `FilterValueError` | `.field`, `.operator` |
| `RelationValueError` | `.field`, `.reason` |
| `DryRunUnsupportedError` | `.operation` |
| `SqlQueryError` | `.reason` |
| `UnknownDashboardError` · `UnknownQueryError` | `.dashboard` / `.query`, `.known` |
| `ErpApiError` | `.status`, `.trace`, `.details` |

Workflows, the drive, shared variables, conversations and the task board are skill
`erp-tools`; `schema.json` helpers and the browser initData bridge are skill
`erp-miniapp`.
