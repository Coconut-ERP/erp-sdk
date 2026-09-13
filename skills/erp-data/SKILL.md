---
name: erp-data
description: Reads, writes, queries and analyses data in a Coconut ERP workspace with erp-sdk (TypeScript/JavaScript) — records through ObjectHandle and RecordQuery, DataFrame, read-only SQL, dashboards and saved queries, relations, imports, exports, bulk updates and ERP_ENV dry runs. Use when a script has to fetch, aggregate, import, export or edit ERP records, e.g. "revenue by month from the ERP", "import this CSV into a table", "bulk update order statuses", "join two tables", "create a dashboard". Building a web app on the ERP is erp-miniapp; workflows, the drive and the task board are erp-tools; the wiki is erp-wiki.
---

# ERP data with erp-sdk

The ERP stores data as objects (tables) → fields (columns) → records (rows). Work
on it by writing a script against the SDK and running it; the `erp` CLI only checks
the environment and shows the schema.

1. **Names are addresses.** Read the real schema before writing code; a guessed
   name fails at runtime with `UnknownObjectError` / `UnknownFieldError`.
2. **A script that writes runs under `ERP_ENV=development` first** — same file, no
   edits. This is the user's real data.
3. **No credentials, no guessing.** Without `ERP_BASE_URL` and `ERP_API_KEY`, ask.

## 1. Set up and read the schema

```bash
npm install https://github.com/Coconut-ERP/erp-sdk/releases/download/latest/erp-sdk.tgz
npx erp doctor                            # env, connectivity, permissions → {ok, checks[]}
npx erp objects list
npx erp objects show "Order"              # fields, types, config
npx erp schema dump --out workspace.json
```

`latest` suits a one-off script; a project with a lockfile pins the version URL
from the README. In `objects show`, read each field's `type` and `config`: the
target of a `relation`, the `options` of a `single_select`, and
`source: "workspace_users"`, which means the value is a user id.

```ts
import { createMiniApp } from "erp-sdk";

const erp = await createMiniApp({
  baseUrl: process.env.ERP_BASE_URL,
  apiKey: process.env.ERP_API_KEY,
  permissions: [
    { resource: "object", action: "read" },
    { resource: "object:field", action: "read" },
    { resource: "object:record", action: "read" },
  ],
});
```

`permissions` is a preflight: a missing pair throws `MissingPermissionsError`
listing `.missing` before any real call. Add `object:record` `create` / `update` /
`delete` when the script writes, `dashboard` for SQL. Run it with
`node --env-file=.env script.mjs` or `npx tsx script.ts`, from a scratch directory
rather than the user's source tree.

## 2. Read

```ts
const orders = await erp.object("Order");            // display name or id
const paid = () => orders.records().where("Status", "equals", "paid");

await paid().orderBy("Total Amount", "desc").limit(50).withTotal().fetch();
// { records, nextCursor, hasMore, total }
await paid().fetchAll({ max: 5000 });
await paid().count();
```

Server limits: 20 filters, 3 sorts, 100 records per page, 200 values for
`in` / `not_in`.

`relation` fields hold arrays of record ids. Resolve them without N+1, in this order
of preference: `preload()`, then `getMany(ids)`, then `DataFrame.leftJoin`. Never
call `get(id)` in a loop.

## 3. Analyse

| Need | Use |
| --- | --- |
| `GROUP BY`, joins, ranking over many rows | `erp.sql` — one read-only `SELECT`, ≤ 1,000 rows, no cursor |
| Row-level logic, whole records, > 1,000 raw rows | `toFrame()` → `DataFrame` |

```ts
const df = await orders.records().toFrame({ max: 20000 });
df.groupBy("Customer")
  .agg({ revenue: ["sum", "Total Amount"], orders: ["count"] })
  .sortBy("revenue", "desc").head(10).toArray();

const result = await erp.sql(
  `SELECT "Customer" AS customer, SUM("Total Amount")::float8 AS revenue
   FROM "Order" WHERE "Order Date" >= @from GROUP BY 1 ORDER BY 2 DESC`,
  { params: [{ name: "from", type: "date" }], values: { from: "2026-01-01" } },
);
```

In SQL, tables and columns are display names, double-quoted and case-sensitive, and
`numeric` columns come back as strings — cast with `::float8`. Report with
`console.table` and a summary, not thousands of rows on stdout.

## 4. Write — rehearse first

```ts
await orders.create({ "Order Code": "ORD-001", "Total Amount": 500000 });
await orders.createMany(rows);                          // chunks of 500, each one transaction
await orders.update(id, { Status: "paid" });            // reads the version when omitted
await orders.records().where("Status", "equals", "new")
  .update({ Status: "processing" }, { limit: 1000 });   // bulk
```

```bash
ERP_ENV=development node script.mjs   # the server runs every write, then rolls back
node script.mjs                       # for real, once the numbers look right
```

Development mode covers `create`, `createMany`, `update` and bulk update: errors are
the same as a live run, success leaves nothing behind, and returned ids are fake.
`delete`, `restore`, `createLink` and `deleteLink` have no dry run and throw
`DryRunUnsupportedError` instead. Changing a table's definition always writes for real.

For every bulk write:

1. `count()` the exact filter and tell the user the number.
2. Run in development mode; report `matched` / `created` and any errors.
3. Ask before running a large or destructive change for real.

**Writing a relation replaces its whole list.** `[a, b]` leaves exactly those links,
`[]` clears them, and `null` or a missing key leaves them untouched — unlike other
fields, where `null` clears the value. To add one link, send
`[...orders.linkedIds(record, "Line Items"), newId]`. Limits and link calls:
`references/api.md`.

## Pitfalls

- `RecordQuery` is stateful: `count()` and `first()` change its `limit`, so build a
  fresh chain for each call.
- `fetchAll()` has no default cap; pass `{ max }`.
- Zero rows is usually the caller's row scope, not the filter — `npx erp whoami`.
- `createdAt` / `updatedAt` cannot be filtered or sorted; only real fields and `id` can.
- `get(id)` returns no relations; query instead, or `preload`.
- `formula` / `lookup` / `rollup` values live in `computedData` and recalculate in
  the background, so they can lag a write.
- `sum` / `avg` turn unparseable strings into `0`; check the column first.
- After a structure change the client did not make, call `erp.invalidate()` or the
  cache keeps the old fields.
- `updateDefinition({ name?, groups?, position? })` edits the table, `update` edits a
  row. A table has no description, and `groups` replaces the whole list.
- `erp.dashboards.list()` paginates before filtering by sharing; use `listAll()`.

## Permissions and keys

A service-account key (`erp_sk_…`) is normally a `writer`: full access to records,
files and dashboards, read-only on objects, fields and the wiki. It cannot create
tables or fields (403) — that takes an admin key and the user's explicit go-ahead.
`erp.asUser(accessToken)` runs as one user, under their permissions and row scope.

Never log, commit, print or write an API key into output files.

## References

- `references/api.md` — the client, `ObjectHandle`, `RecordQuery`, relation writes,
  `DataFrame`, dashboards, errors.
- `references/sql.md` — the SQL surface: names, parameters, return types, examples.
- `references/recipes.md` — runnable scripts: reports, joins, CSV import and export,
  safe bulk updates, audits, dashboards.
- Skill `erp-miniapp` — web apps on the ERP (`schema.json`, initData, deploy).
- Skill `erp-tools` — workflows, the drive, shared variables, copilot conversations,
  the AI task board.
- Skill `erp-wiki` — the workspace wiki, and `erp.wiki.ask` over attached documents.
