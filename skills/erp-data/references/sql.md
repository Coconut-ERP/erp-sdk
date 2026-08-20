# Writing SQL for ERP

`erp.sql(sql, { params, values })` runs **one** read-only `SELECT` in the workspace's
database and returns `{ columns, rows, rowCount, truncated, compiledSql }`.

## Tables and columns are display names

The server translates each object into a CTE named its **display name**, each
field into a column named its display name:

```sql
SELECT "Machine Name", "Actual Output" FROM "Production"
```

| Rule | Details |
| --- | --- |
| Double quotes | Required — names with diacritics or spaces |
| **Case-sensitive** | `FROM "production"` → 400 `Unknown table`. Get the correct name: `npx erp objects list` |
| System columns | Every table has `id`, `created_at`, `updated_at` |
| Computed fields | `formula`/`lookup`/`rollup` work like regular columns |
| `relation` fields | Return as **uuid arrays** (`uuid[]`) |
| Only workspace tables | `pg_catalog`, `information_schema`… are blocked |
| `@workspace_id` | Always available, correct for your credential |

`compiledSql` in the result shows the actual query the server ran — use it to understand how a
field was translated.

## Endpoint rules

- **One statement.** `WITH … SELECT` is OK; `;` then a second statement → 400. `(SELECT …)
  UNION ALL (SELECT …)` is rejected because it doesn't start with `SELECT` — drop the parens.
- **Read-only.** INSERT/UPDATE/DELETE/DDL all rejected; data writes are `ObjectHandle`'s job.
- **Max 1,000 rows**, `truncated: true` when cut, **no cursor**.
  → Aggregate in SQL. For more raw data use
  `records().fetchAll()`.
- SQL ≤ 20,000 characters, ≤ 20 parameters.
- Row scope of the caller still applies — results may differ by user.

## Return data types

| Postgres | JSON |
| --- | --- |
| `numeric` (all number-type fields, `SUM`, `AVG`) | **string** — `"327970"` |
| `::float8`, `::int`, `COUNT(*)` | number |
| `timestamptz` | ISO string `"2026-08-12T00:00:00Z"` |
| `uuid[]` (relation) | string `"{uuid,uuid}"` |

Cast right in SQL for cleanliness:

```sql
SUM("Total Amount")::float8 AS revenue
AVG("Actual Output")::float8 AS average
```

`DataFrame` auto-casts when you `sum`/`avg`/`sortBy`, so you only need to worry when reading
`rows` directly or exporting to JSON/CSV.

## Parameters

```ts
await erp.sql(
  `SELECT "Customer" AS customer, SUM("Total Amount")::float8 AS amount
   FROM "Order"
   WHERE "Order Date" >= @startDate AND "Order Date" < @endDate AND "Status" = @status
   GROUP BY 1 ORDER BY 2 DESC`,
  {
    params: [
      { name: "startDate",  type: "date" },
      { name: "endDate", type: "date" },
      { name: "status",  type: "text", default: "paid" },
    ],
    values: { startDate: "2026-01-01", endDate: "2027-01-01" },
  },
);
```

`type`: `text` · `number` · `boolean` · `date` · `datetime`. Server casts by declaration,
values go separately from the statement — **never concatenate values into SQL**.
For saved queries, pass values to `dash.run(name, { startDate: "…" })`; missing parameters use `default`.

## Example queries

```sql
-- aggregate by month
SELECT to_char("Order Date", 'YYYY-MM') AS month,
       SUM("Total Amount")::float8 AS revenue,
       COUNT(*) AS order_count
FROM "Order"
GROUP BY 1 ORDER BY 1;

-- join two tables on text field
SELECT p."Customer Name" AS customer, SUM(o."Quantity")::float8 AS total_qty
FROM "PurchaseOrder" o
JOIN "Product" p ON o."Product Name" = p."Product Code"
GROUP BY 1 ORDER BY 2 DESC;

-- join via relation field (relations are uuid arrays)
SELECT c."Customer Name" AS customer, SUM(o."Total Amount")::float8 AS amount
FROM "Order" o
JOIN "Customer" c ON c.id = ANY(o."Customer")
GROUP BY 1;

-- rank within group
SELECT * FROM (
  SELECT "Machine Name" AS machine,
         to_char("Date", 'YYYY-MM') AS month,
         SUM("Actual Output")::float8 AS output,
         ROW_NUMBER() OVER (PARTITION BY to_char("Date", 'YYYY-MM')
                            ORDER BY SUM("Actual Output") DESC) AS rank
  FROM "Production" GROUP BY 1, 2
) t WHERE rank <= 3;

-- distribution by status
SELECT "Status" AS status, COUNT(*) AS count
FROM "Order" GROUP BY 1 ORDER BY 2 DESC;
```

## When NOT to use SQL

- Need complete `RecordDto` (version for update, `computedData`, relations as id arrays) → use `records()`.
- Need > 1,000 raw rows → use `fetchAll({ max })`.
- Writing data → use `create` / `update` / `createMany`.
