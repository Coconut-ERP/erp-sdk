# Recipes

Each recipe continues the script from `SKILL.md` §1 — `erp` is the client — with
`const orders = await erp.object("Order")`. Field names are examples; read the real
ones with `npx erp objects show`. A recipe that writes runs twice, unchanged:
`ERP_ENV=development node script.mjs`, then `node script.mjs`.

## Contents

1. [Monthly report](#1-monthly-report)
2. [Export CSV](#2-export-csv)
3. [Join through a relation](#3-join-through-a-relation)
4. [Create records with their links](#4-create-records-with-their-links)
5. [Import CSV or JSON](#5-import-csv-or-json)
6. [Safe bulk update](#6-safe-bulk-update)
7. [Update with a version check](#7-update-with-a-version-check)
8. [Data quality audit](#8-data-quality-audit)
9. [Save a query as a dashboard](#9-save-a-query-as-a-dashboard)

## 1. Monthly report

```js
const df = await orders.records()
  .where("Order Date", "greater_than_or_equal", "2026-01-01")
  .where("Status", "in", ["paid", "shipped"])
  .toFrame({ max: 50000 });

const byMonth = df
  .groupBy((r) => String(r["Order Date"]).slice(0, 7), { as: "Month" })
  .agg({
    Revenue: ["sum", "Total Amount"],
    Orders: ["count"],
    Largest: ["max", "Total Amount"],
  })
  .sortBy("Month");

console.table(byMonth.toArray());
console.log("Total:", df.sum("Total Amount").toLocaleString("en-US"));
```

Over tens of thousands of rows, do the same in SQL (`sql.md`) and fetch only the
aggregate.

## 2. Export CSV

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

writeFileSync("orders.csv", "﻿" + toCsv(rows), "utf8");   // BOM so Excel reads UTF-8
```

## 3. Join through a relation

```js
// (a) preload — the server loads the related rows with the query
const records = await orders.records().preload("Customer", { limit: 3 }).fetchAll({ max: 5000 });
for (const rec of records) {
  console.log(rec.id, orders.related(rec, "Customer")[0]?.data);
}

// (b) getMany — collect ids once, when many rows share the same targets
const customers = await erp.object("Customer");
const ids = [...new Set(records.flatMap((r) => orders.linkedIds(r, "Customer")))];
const byId = Object.fromEntries(
  (await customers.getMany(ids)).map((c) => [c.id, customers.rowFromRecord(c)]),
);

// (c) leftJoin — when both tables feed an aggregate
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

## 4. Create records with their links

```js
const lines = await erp.object("Order Line");

const created = await lines.createMany([
  { Product: "SKU-1", Quantity: 2 },
  { Product: "SKU-2", Quantity: 1 },
]);

await orders.create({
  "Order Code": "ORD-001",
  "Line Items": created.records.map((r) => r.id),   // ids, in display order
});
```

Editing the list means sending every id to keep:

```js
const rec = await orders.records().where("Order Code", "equals", "ORD-001").first();
const existing = orders.linkedIds(rec, "Line Items");

await orders.update(rec.id, { "Line Items": [...existing, newId] });                     // add
await orders.update(rec.id, { "Line Items": existing.filter((i) => i !== removeId) }); // remove
await orders.update(rec.id, { Status: "paid" });                                        // links untouched
```

Never let `undefined` become `[]` on the way to a write — that deletes links. Past
100 ids, use `orders.createLink(rec.id, "Line Items", newId, position)` and
`orders.deleteLink(rec.id, "Line Items", removeId)`.

## 5. Import CSV or JSON

```js
import { readFileSync } from "node:fs";

const raw = JSON.parse(readFileSync("input.json", "utf8"));   // quoted CSV needs a real parser
const products = await erp.object("Product");
const known = new Set(products.fields.map((f) => f.name));

const rows = raw.map((r) => ({
  "Product Name": String(r.name).trim(),
  "Sale Price": Number(r.price),
  Category: r.category ?? null,
}));
for (const col of Object.keys(rows[0])) {
  if (!known.has(col)) throw new Error(`Table has no field "${col}"`);
}
console.log(rows.slice(0, 3));

const result = await products.createMany(rows);
console.log(
  result.dryRun
    ? `Rehearsal passed: ${rows.length} rows valid. Run without ERP_ENV to write.`
    : `Created ${result.created} records`,
);
```

In development mode the server validates every row — types, `unique`, relation ids —
and the error names the row. No custom `--apply` flag is needed.

## 6. Safe bulk update

```js
const matching = () => orders.records().where("Status", "equals", "new");

const total = await matching().count();
console.log(`${total} orders will move to "processing"`);

const rehearsal = await matching().update({ Status: "processing" }, { dryRun: true });
console.log(`Rehearsal: matched ${rehearsal.matched}`);
if (erp.dryRun) process.exit(0);

let done = 0;
for (;;) {
  const res = await matching().update({ Status: "processing" }, { limit: 1000 });
  done += res.updated;
  console.log(`${done}/${total}`);
  if (!res.hasMore) break;
}
```

The loop ends only because each update moves rows out of the filter. When the field
being set is not part of the filter, collect the ids first and update by id chunks.

## 7. Update with a version check

```js
import { ErpApiError } from "erp-sdk";

async function updateSafely(handle, id, patch, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    const current = await handle.get(id);
    try {
      return await handle.update(id, patch(handle.rowFromRecord(current)), current.version);
    } catch (error) {
      if (!(error instanceof ErpApiError) || error.status !== 409 || attempt >= retries) throw error;
    }
  }
}

await updateSafely(orders, id, (row) => ({ "Total Amount": Number(row["Total Amount"]) + 1000 }));
```

A 409 means someone else wrote first: re-read and reapply, never force the version.

## 8. Data quality audit

```js
const df = await orders.records().toFrame({ max: 50000 });

console.log("Missing customer:", df.where("Customer", "is_empty").count());
console.log("By status:", df.countBy("Status"));
console.log("Duplicate codes:", Object.entries(df.countBy("Order Code")).filter(([, n]) => n > 1));
console.table(df.where("Total Amount", "less_than", 0).select("id", "Total Amount").toArray());
```

## 9. Save a query as a dashboard

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

const rows = await (await erp.dashboard("Operations")).run("Revenue by month");
```

A dashboard is a definition, so creating it writes for real in development mode too.
