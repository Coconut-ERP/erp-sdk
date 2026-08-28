---
name: erp-data
description: Read, write, query SQL, analyze data, manage files, and run workflows on Coconut ERP workspace using erp-sdk (TypeScript/JavaScript). Use when the task mentions erp-sdk, ErpClient, ObjectHandle, RecordQuery, DataFrame, erp.sql / dashboard / saved queries / charts, workflows / cron / publish / run on ERP, upload/download files or folders on ERP, renaming a table or changing its groups, ERP_API_KEY / erp_sk_, ERP_ENV / dryRun / test run before writing, link–relation between two tables, object–field–record of ERP, or when the user wants to fetch/aggregate/import/edit data on ERP ("get order list from ERP", "revenue report by month", "aggregate by month using SQL", "create dashboard", "run scheduled script each morning", "import CSV to table", "bulk update", "join two tables", "export Excel/CSV from ERP"). For building web apps using ERP as backend (schema.json, initData, deploy) use the erp-miniapp skill.
---

# Working with ERP data using erp-sdk

Coconut ERP stores data in an **object engine**: object (table) → field (column) →
record (row). `erp-sdk` is a TypeScript layer on top of the REST API.

**Default approach: write a runnable script then execute it.** The `erp` CLI is only for setting up the environment and viewing the real schema — all read/write/analysis operations are written using the SDK, since multi-step logic (join, aggregation, count before write) cannot be expressed with command-line flags.

**Two rules to never forget:**

1. **Object/field names are data addresses.** Guessing wrong → `UnknownObjectError` /
   `UnknownFieldError` at runtime. Fetch the real schema before writing code (§2).
2. **Scripts that write must test first** using `ERP_ENV=development` (§7) — same
   file, no changes needed. This is real user data.

## 1. Connecting

```bash
npm install https://github.com/Coconut-ERP/erp-sdk/releases/download/v0.4.1/erp-sdk.tgz
npx erp doctor        # env + connection + permissions → {ok, checks[]}, exit 1 if broken
```

```
ERP_BASE_URL=https://erp.example.com
ERP_API_KEY=erp_sk_...
ERP_ENV=development     # optional — makes all record write commands dry runs
```

Without credentials, **ask the user** — don't guess the URL/key or table names.

```ts
import { createMiniApp } from "erp-sdk";

const erp = await createMiniApp({
  baseUrl: process.env.ERP_BASE_URL,
  apiKey: process.env.ERP_API_KEY,
  permissions: [                       // preflight: missing permissions dies here immediately
    { resource: "object", action: "read" },
    { resource: "object:field", action: "read" },
    { resource: "object:record", action: "read" },
  ],
});
```

Add `object:record` + `create`/`update`/`delete` when the script writes; `dashboard`
for SQL; `workflow` for automation. Run: `node --env-file=.env script.mjs`
(Node 20.6+) or `npx tsx script.ts`. Place scripts in a temporary directory, don't scatter into source.

## 2. View the real schema first

```bash
npx erp objects list                      # which tables exist
npx erp objects show "Order"              # which fields, what type, what config
npx erp schema dump --out workspace.json  # full dump, load as context
```

Read carefully `type` and `config`: which table does `relation` point to, what `options` does `single_select` have, `source: "workspace_users"` means the value stores **user id**.

## 3. Reading

```ts
const orders = await erp.object("Order");        // by display name or id

await orders.records()
  .where("Status", "equals", "paid")
  .orderBy("Total Amount", "desc")
  .limit(50).withTotal().fetch();                   // { records, nextCursor, hasMore, total }

await orders.records().where(…).fetchAll({ max: 5000 });   // auto-paginate to cursor end
await orders.records().where(…).first();
await orders.records().where(…).count();
```

Server limits: **20 filters, 3 sorts, 100 records/page**, `in`/`not_in` max
**200 values**. Full operators and signatures: `references/api.md`.

## 4. Relations — avoid N+1

`relation` fields live in `data` as **arrays of ids**. Three approaches, in order of preference: `preload()` (server loads with results) → `getMany(ids)` (1 request/200 ids) →
`leftJoin` on DataFrame. **Never call `handle.get(id)` in a loop.**

## 5. Analysis: DataFrame

`toFrame()` = `fetchAll()` + flatten to rows, columns by **display name**.
Frames are immutable, every method returns a new frame.

```ts
const df = await orders.records().where(…).toFrame({ max: 20000 });

df.groupBy("Customer")
  .agg({ revenue: ["sum", "Total Amount"], orderCount: ["count"] })
  .sortBy("revenue", "desc").head(10).toArray();
```

For reports, use `console.table` with a summary — don't dump thousands of rows to stdout.

## 6. Heavy aggregation: read-only SQL

`RecordQuery` filters on **one** table only. For `GROUP BY`, `JOIN`, ranking — write SQL,
fetch only aggregated results:

```ts
const df = (await erp.sql(`
  SELECT "Customer" AS customer, SUM("Total Amount")::float8 AS revenue
  FROM "Order" WHERE "Order Date" >= @startDate
  GROUP BY 1 ORDER BY 2 DESC
`, { params: [{ name: "startDate", type: "date" }], values: { startDate: "2026-01-01" } })).toFrame();
```

Tables/columns are display names, **case-sensitive**, must be double-quoted. One
`SELECT` statement, max **1,000 rows**, no cursor → aggregate in SQL. `numeric` columns
return as **strings** in JSON — use `::float8` if you need numbers. Syntax, parameters, examples:
`references/sql.md`.

## 7. Writing — and test first

```ts
await orders.create({ "Order Code": "ORD-001", "Total Amount": 500000 });
await orders.createMany(rows);                       // auto-chunks into 500s
await orders.update(id, { "Status": "paid" });   // auto-reads version
await orders.records().where(…).update(patch, { limit: 1000 });   // bulk
```

`ERP_ENV=development` makes **all record write commands** dry runs: server executes
the real statement (validate, unique, version, relation ids, rules) then
**rolls back**. Errors are identical to live runs; success leaves no trace.

```bash
ERP_ENV=development node script.mjs   # test everything
node script.mjs                        # commit if numbers look good
```

`delete`, `restore`, `createLink`, `deleteLink`, `workflow.run()` have **no**
dry run — in development mode they throw `DryRunUnsupportedError` instead of silently succeeding. **IDs returned from dry-run create are fake**, never persisted.

**Mandatory procedure for bulk write tasks:**

1. `.count()` on the exact filter first, **report the number to the user**.
2. Run `ERP_ENV=development`, report `matched`/`created` and any errors.
3. Large or destructive operations (bulk update, delete, status changes):
   **ask for confirmation** before running for real.

### Writing relations = replace entire list

| What you send | Result |
| --- | --- |
| key not in `data` | links stay as-is |
| `"Line Items": null` | **same as not sending the key** — links stay as-is |
| `"Line Items": [a, b]` | links become **exactly** a, b; old links disappear |
| `"Line Items": []` | **clear all links** for this field |

Unlike regular fields (where `null` = *delete value*). Adding 1 link to a record with 3 existing = send all 4 ids: `[...orders.linkedIds(rec, "Line Items"), newId]`.
Max **100 ids/field/record**; longer requires `createLink`/`deleteLink` individually.

## 8. Workflows — scripts running on ERP server

Scheduled tasks (deadline reminders every morning, nightly sync) don't need a separate service: a workflow is a TypeScript file with `async function main(input)`, ERP stores the code, secrets, and schedule.

```ts
const wf = await erp.workflows.create({ name, code, trigger: { type: "cron",
  config: { schedule: "0 0 9 * * *", timezone: "Asia/Ho_Chi_Minh" } } });
await wf.publish();          // ⚠ runs use old version until published
```

Four common mistakes: triggers are only `manual`/`cron`/`webhook` (no record events);
cron is **6 fields with seconds**; **any edit reverts to draft**, must republish;
`setEnv` **replaces the entire map**. Full workflow management: `references/workflows.md`.

Prove code before saving it — neither call stores anything:

```ts
const report = await erp.workflows.check(code);       // { valid, error? { message, line, column } }
const t = await erp.workflows.testRun({ code, input, workflowId });   // { ok, result, logs, error? }
const t2 = await wf.testRun(code, input);             // same, as that workflow (its env)
```

**Writing or editing code inside `main()`** — runner sandbox, which modules import, 60s/256KB limits, `check`/`testRun` to test without creating a draft → use skill
**`erp-workflow`**.

Before creating/editing/deleting user workflows: **ask**. These run on real data on a schedule.

## 9. Documents and shared memory

Not everything is a record. Two other stores sit beside the object engine:

```ts
const folder = await erp.files.personalFolder();          // or publicFolder()
const file = await erp.files.upload({ folderId: folder.id, name: "bao-cao.csv", content: csv });
const bytes = await erp.files.downloadText(file.id);
```

The **drive** holds documents (PDF, spreadsheets, images): folders, sharing, and a
trash that keeps a deletion for 7 days. The root is not writable — it holds exactly
two system folders, the caller's personal one and the workspace `Public` tree — so
every upload names a folder inside one of them. An upload is three steps (row →
presigned PUT → complete) that `upload()` does in one. Details:
`references/files.md`.

The **wiki** is what the workspace has concluded, written down: pages, the sources
they cite, and `ask()` retrieval over documents attached to a page.

```ts
const passages = await erp.wiki.ask("chinh-sach-ton-kho", "Tồn tối thiểu nhóm A?");
```

Reading it (catalog, search, `ask`) is the floor permission and useful in almost any
script that has to explain a number. **Writing** it — pages, sources, attachments,
lint — is its own job: use skill **`erp-wiki`**.

## Lessons learned (pitfalls)

- **`RecordQuery` is stateful builder**: `count()`/`first()` mutate `limit` —
  build a new chain each time.
- **`fetchAll()` has no default limit** — large tables: remember `{ max }`.
- **Reading 0 rows** is usually IAM row scope, not a wrong filter (`npx erp whoami`).
- **`createdAt`/`updatedAt` cannot be filtered or sorted** — filters only accept real
  table fields, plus the special key `id`.
- **`get(id)` doesn't return relations** — for id arrays use query, or `preload`.
- **Computed fields** (`formula`/`lookup`/`rollup`) live in `computedData`, background-calculated,
  may not update immediately after write.
- **`sum`/`avg` coerce unparseable strings to `0`** — check column before trusting numbers.
- **After changing table structure, call `erp.invalidate()`**, otherwise cache keeps old fields.
  (`updateDefinition`/`rename`/`setGroups` do it for you.)
- **A table stores a name, its `groups` and a position — no description.** Change them
  with `handle.updateDefinition({ name?, groups?, position? })`; `groups` replaces the
  list whole (≤ 10), so add one by sending `[...handle.groups, "Kho"]`. Needs
  `object:update`, which a mini app's key does not have.
- **`updateDefinition` edits the table, `update` edits a row** — one word apart.
- **`erp.dashboards.list()` paginates before filtering permissions** — use `listAll()`.

## Permissions and boundaries

`erp_sk_…` keys are **service accounts**, typically at `writer` level: full access to
records, files and dashboards, read-only on `object`/`object:field` and on the wiki, so
they **cannot create tables/fields** (403). To create tables use admin keys — don't do it yourself,
**ask the user first**. To run as a specific user: `erp.asUser(accessToken)`.

**API keys stay on server.** Never log, commit, ship to browser, or write to output files.

## References

- `references/api.md` — SDK data surface: signatures, types, limits, errors.
- `references/recipes.md` — runnable example scripts: reports, joins, CSV import,
  safe bulk updates, CSV export, data quality checks.
- `references/sql.md` — writing SQL for ERP: table/column names, parameters, return types, examples.
- `references/workflows.md` — complete workflows: triggers, version/publish, env,
  runs and reading results.
- `references/files.md` — the drive: folders, upload/download, sharing, trash.
- Writing **code that runs inside workflows** (runtime, allowed modules, limits,
  `test-run`) → skill **`erp-workflow`**.
- Building **mini apps** (web apps using ERP as backend, `schema.json`, initData,
  deploy) → skill **`erp-miniapp`**.
- Writing and maintaining the **workspace wiki** (pages, sources, attachments, `ask`
  retrieval, lint) → skill **`erp-wiki`**.
