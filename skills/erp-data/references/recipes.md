# Recipes — runnable scripts

Each section is a `.mjs` file run with `node --env-file=.env <file>` (Node 20.6+),
or `.ts` run with `npx tsx`. Node 18: load env yourself:
`ERP_BASE_URL=… ERP_API_KEY=… node file.mjs`.

Scripts that write should run twice, **same file, no edits**:

```bash
ERP_ENV=development node script.mjs   # server validates and rolls back
node script.mjs                        # commit if numbers look good
```

## 0. Common scaffold

```js
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

Add `{ resource: "object:record", action: "create" }` / `"update"` /
`"delete"` when the script writes — declare only what you use, missing permissions
die at init, not mid-request. Scripts using SQL/dashboards need permissions on `dashboard` / `dashboard:query`, workflow scripts need
`workflow` / `workflow:run` (`npx erp whoami` to see what your key has) — and import
`runResult`, `runLogs`, `WORKFLOW_ENV_KEEP` from `erp-sdk`.

## 1. Snapshot real schema to file

```js
const snapshot = [];
for (const meta of await erp.objects()) {
  const handle = await erp.object(meta.id);
  snapshot.push({
    name: meta.name,
    fields: handle.fields
      .filter((f) => !f.isArchived)
      .map((f) => ({ name: f.name, key: f.key, type: f.type, config: f.config })),
  });
}
console.log(JSON.stringify(snapshot, null, 2));
```

Equivalent to `npx erp schema dump`, but filterable and formattable.

## 2. Aggregation report → summary table

```js
const orders = await erp.object("Order");

const df = await orders.records()
  .where("Order Date", "greater_than_or_equal", "2026-01-01")
  .where("Status", "in", ["paid", "shipped"])
  .toFrame({ max: 50000 });

const byMonth = df
  .groupBy((r) => String(r["Order Date"]).slice(0, 7), { as: "Month" })
  .agg({
    "Revenue": ["sum", "Total Amount"],
    "Order Count": ["count"],
    "Largest Order": ["max", "Total Amount"],
  })
  .sortBy("Month");

console.table(byMonth.toArray());
console.log("Total:", df.sum("Total Amount").toLocaleString("en-US"));
```

`console.table` reads much better than raw JSON. For long reports, print top-N
(`.head(20)`) then write the full version to file.

## 3. Export CSV (opens in Excel)

```js
import { writeFileSync } from "node:fs";

function toCsv(rows) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v) => {
    const s = v == null ? "" : Array.isArray(v) ? v.join("|") : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
}

const rows = (await orders.records().toFrame({ max: 20000 }))
  .select("id", "Order Code", "Customer", "Total Amount", "Status")
  .toArray();

writeFileSync("orders.csv", "﻿" + toCsv(rows), "utf8");   // BOM for Excel
```

## 4. Join two tables via `relation` field

`relation` fields live in `data` as **id arrays**. Three approaches, choose by situation:

```js
// (a) preload — server loads with query, good for just a few relations per row
const records = await orders.records().preload("Customer", { limit: 3 }).fetchAll({ max: 5000 });
for (const rec of records) {
  const customer = orders.related(rec, "Customer")[0];
  console.log(rec.data.code, customer?.data.name);
}

// (b) getMany — collect ids and fetch once, good when relations overlap
const customers = await erp.object("Customer");
const key = orders.fieldKey("Customer");
const ids = [...new Set(records.flatMap((r) => r.data[key] ?? []))];
const byId = Object.fromEntries(
  (await customers.getMany(ids)).map((c) => [c.id, customers.rowFromRecord(c)]),
);

// (c) leftJoin on DataFrame — good when you need both tables for aggregation
const dfOrders = (await orders.records().toFrame({ max: 20000 }))
  .map((r) => ({ ...r, customerId: (r["Customer"] ?? [])[0] }));
const dfCustomers = (await customers.records().toFrame())
  .select("id", "Name", "Region")
  .rename({ id: "customerId" });

dfOrders.leftJoin(dfCustomers, "customerId")
  .groupBy("Region")
  .sum("Total Amount", "Revenue")
  .sortBy("Revenue", "desc")
  .toArray();
```

Never call `handle.get(id)` in a row-by-row loop.

## 5. Writing links: create records with relations in **one** request

Relations are just fields, value is an id array — no "record created but link failed" scenario:

```js
const orders = await erp.object("Order");
const lines = await erp.object("Order Line");

// 1. create line items first to get their ids
const created = await lines.createMany([
  { "Product": "SKU-1", "Quantity": 2 },
  { "Product": "SKU-2", "Quantity": 1 },
]);

// 2. create order with links, one transaction, array order = display order
await orders.create({
  "Order Code": "ORD-001",
  "Line Items": created.records.map((r) => r.id),   // ids, not whole records
});
```

Editing a record's link list — **send all ids you want to keep**, since writing relations
is *replace entire list*:

```js
const rec = await orders.records().where("Order Code", "equals", "ORD-001").first();
const existing = orders.linkedIds(rec, "Line Items");        // read from data

await orders.update(rec.id, { "Line Items": [...existing, newId] });   // add 1
await orders.update(rec.id, { "Line Items": existing.filter((i) => i !== removeId) }); // remove 1
await orders.update(rec.id, { "Line Items": [] });                   // clear all
await orders.update(rec.id, { "Status": "paid" });             // don't touch links
```

`null` = "say nothing about this field" (links stay), `[]` = clear all. Don't let
code silently turn `undefined` into `[]` — that accidentally deletes links.

Importing multiple orders at once: batch into `createMany`, each row carries its links;
backend validates all ids in one pass:

```js
await orders.createMany(
  orders_data.map((d) => ({ "Order Code": d.code, "Line Items": lineIdsByCode[d.code] })),
);
```

Relations **over 100 ids** can't be inline-written (reads are max 100 too) — use
`createLink` / `deleteLink` individually:

```js
await orders.createLink(rec.id, "Line Items", newId, existing.length);
await orders.deleteLink(rec.id, "Line Items", removeId);
```

## 6. Import data from CSV/JSON

```js
import { readFileSync } from "node:fs";

const raw = JSON.parse(readFileSync("input.json", "utf8"));   // CSV with quotes needs
                                                              // a real CSV parser
const products = await erp.object("Product");
const known = new Set(products.fields.map((f) => f.name));

// 1. map + validate column names BEFORE network call
const rows = raw.map((r) => ({
  "Product Name": String(r.name).trim(),
  "Sale Price": Number(r.price),
  "Category": r.category ?? null,
}));
for (const col of Object.keys(rows[0])) {
  if (!known.has(col)) throw new Error(`Table has no field "${col}"`);
}

// 2. preview 3 rows
console.log(rows.slice(0, 3));

// 3. write — SDK auto-chunks into 500s, each chunk is one transaction.
//    ERP_ENV=development makes this dry run: server validates each row
//    (unique, type, relation ids) then rolls back; errors show which row.
const result = await products.createMany(rows);
console.log(
  result.dryRun
    ? `Test passed: ${rows.length} rows valid. Remove ERP_ENV and run again to commit.`
    : `Created ${result.created} records`,
);
```

No custom `APPLY=1` flags needed: `ERP_ENV=development` runs the **exact same** path as live
(including server errors), instead of just printing the payload and exiting early.

## 7. Safe bulk updates

```js
const filterOf = () => orders.records().where("Status", "equals", "new");

const total = await filterOf().count();          // count first, report the number
console.log(`${total} orders will change to "processing"`);

// test once: matched is real, no rows changed yet
const test = await filterOf().update({ "Status": "processing" }, { dryRun: true });
console.log(`Test: matched ${test.matched}, will update ${test.updated}`);
if (erp.dryRun) process.exit(0);                 // stop here in ERP_ENV=development

let done = 0;
for (;;) {
  const res = await filterOf().update({ "Status": "processing" }, { limit: 1000 });
  done += res.updated;
  console.log(`${done}/${total}`);
  if (!res.hasMore) break;
}
```

This loop terminates because the update **moves updated rows out of the filter**. If
the field you're setting isn't in the filter, the loop runs forever — get id list first,
then update by id chunks instead.

## 8. Update with version check (prevent lost data)

```js
import { ErpApiError } from "erp-sdk";

async function updateSafely(handle, id, patch, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    const current = await handle.get(id);
    try {
      return await handle.update(id, patch(handle.rowFromRecord(current)), current.version);
    } catch (error) {
      // 409 = someone just overwrote it: re-read and retry, don't force version
      if (!(error instanceof ErpApiError) || error.status !== 409 || attempt >= retries) throw error;
    }
  }
}

await updateSafely(orders, id, (row) => ({ "Total Amount": Number(row["Total Amount"]) + 1000 }));
```

## 9. Data quality audit

```js
const df = await orders.records().toFrame({ max: 50000 });

console.log("Missing customer:", df.where("Customer", "is_empty").count());
console.log("By status:", df.countBy("Status"));

// duplicate order codes
const dup = Object.entries(df.countBy("Order Code")).filter(([, n]) => n > 1);
console.log("Duplicate codes:", dup);

// anomalies
df.where("Total Amount", "less_than", 0).toArray().forEach((r) => console.log(r.id, r["Total Amount"]));
```

## 10. Run as a specific user

```js
const asUser = erp.asUser(userAccessToken);       // or (await erp.session(initData)).client
const visible = await (await asUser.object("Order")).records().count();
```

This client is limited by that user's IAM permissions + row scope — use when you need
to know "what does this user actually see", not when you need complete data.

## 11. Report via SQL, aggregate on client

Heavy lifting in SQL, fetch only aggregated rows:

```js
const revenue = (await erp.sql(`
  SELECT to_char("Order Date", 'YYYY-MM') AS month,
         "Customer" AS customer,
         SUM("Total Amount")::float8 AS amount
  FROM "Order"
  WHERE "Order Date" >= @startDate
  GROUP BY 1, 2
`, { params: [{ name: "startDate", type: "date" }], values: { startDate: "2026-01-01" } })).toFrame();

console.table(
  revenue.groupBy("month").sum("amount", "total").sortBy("month").toArray(),
);
```

Remember `::float8` — `numeric` columns return as **strings** in JSON. Max 1,000 rows, no cursor:
if `r.truncated` is `true`, your SQL is missing `GROUP BY`.

## 12. Save query as dashboard for users

```js
const dash = await erp.dashboards.create({ name: "Operations", description: "Daily metrics" });

await dash.addQuery({
  name: "Revenue by month",
  sql: `SELECT to_char("Order Date", 'YYYY-MM') AS month,
               SUM("Total Amount")::float8 AS revenue
        FROM "Order" GROUP BY 1 ORDER BY 1`,
  chartType: "line",
  chartConfig: { x: "month", y: "revenue" },
});

// re-run anytime from script
const rows = await (await erp.dashboard("Operations")).run("Revenue by month");
```

## 13. Workflow running 9am daily

Build workflow, publish, test, read results — full example with all rules
(triggers, version/publish, write-only env): **`references/workflows.md`**.

## Lessons learned (pitfalls)

- **`createdAt` / `updatedAt` can't be filtered or sorted.** Filters only accept real
  table fields, plus the special key `id`. To filter by time, the table must have its own
  `date`/`datetime` field. (`rowFromRecord` still returns `createdAt`/`updatedAt`, so you can filter client-side with `DataFrame`.)
- **Query is a stateful builder**: `count()`/`first()` mutate `limit` —
  build new chain each call (see `filterOf()` in recipe 7).
- **`fetchAll()` has no default limit** — large tables: remember `{ max }`.
- **`in`/`not_in` max 200 values**; more: chunk yourself, or use
  `getMany` (already chunks).
- **Silent numeric coercion**: `sum`/`avg` turn unparseable strings to `0`.
  Check with `df.where("Column", "is_empty").count()` before trusting numbers.
- **Reading 0 rows** is usually IAM row scope, not a wrong filter —
  `npx erp whoami` to see real permissions.
- **Computed fields** (`formula`, `lookup`, `rollup`) live in `computedData`, read-only,
  background-calculated — may not update immediately after write.
- **After changing table structure, call `erp.invalidate()`**, otherwise cache
  keeps the old field list.
- **Writing relations is replace-entire-list, not append**: missing ids = clear links. Read
  `linkedIds()` and send all back.
- **`get(id)` doesn't return relations** — for id arrays use
  `records().…` (query), or `preload`.
- **IDs from dry-run create are fake** (`ERP_ENV=development`): don't save them,
  don't use as keys for later steps. For real ids, run for real.
- **`delete` has no dry run**: in development it throws
  `DryRunUnsupportedError` instead of deleting — intentional. `workflow.run()` too:
  running workflows is live.
- **SQL is case-sensitive** on table/column names, max 1,000 rows, no cursor —
  and `numeric` columns return as **strings** (`::float8` for numbers).
- **Forgot to `publish()` after editing workflow** → runs still use old version. And `setEnv`
  replaces entire map: names you don't send are lost.
- **`erp.dashboards.list()` paginates before filtering permissions** — short page
  doesn't mean end of list, use `listAll()`.
