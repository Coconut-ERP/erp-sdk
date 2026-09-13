# SQL on the ERP

`erp.sql(sql, { params, values })` runs **one** read-only `SELECT` against the
workspace and returns `{ columns, rows, rowCount, truncated, compiledSql }`.

## Contents

- [Names](#names)
- [Endpoint rules](#endpoint-rules)
- [Return types](#return-types)
- [Parameters](#parameters)
- [Examples](#examples)
- [When not to use SQL](#when-not-to-use-sql)

## Names

The server compiles each object into a CTE named after its **display name**, with
fields as columns of the same names:

```sql
SELECT "Machine Name", "Actual Output" FROM "Production"
```

| Rule | Detail |
| --- | --- |
| Double quotes | Always — names carry spaces and diacritics |
| Case-sensitive | `FROM "production"` → 400 `Unknown table`; copy names from `npx erp objects list` |
| System columns | `id`, `created_at`, `updated_at` on every table |
| Computed fields | `formula` / `lookup` / `rollup` read like any column |
| `relation` fields | `uuid[]` |
| Scope | Workspace tables only; `pg_catalog`, `information_schema` are blocked |
| `@workspace_id` | Always available, bound to the caller |

`compiledSql` shows what actually ran — the way to see how a field was translated.

## Endpoint rules

- **One statement.** `WITH … SELECT` is fine; a second statement after `;` is a 400.
  `(SELECT …) UNION ALL (SELECT …)` is rejected for not starting with `SELECT` — drop
  the outer parentheses.
- **Read-only.** Writes go through `ObjectHandle`.
- **≤ 1,000 rows, no cursor**; `truncated: true` means rows were cut, which usually
  means a missing `GROUP BY`.
- ≤ 20,000 characters and ≤ 20 parameters.
- The caller's row scope still applies, so results can differ between users.

## Return types

| Postgres | JSON |
| --- | --- |
| `numeric` — every number field, `SUM`, `AVG` | **string**, `"327970"` |
| `::float8`, `::int`, `COUNT(*)` | number |
| `timestamptz` | ISO string |
| `uuid[]` | string `"{uuid,uuid}"` |

Cast in the query (`SUM("Total Amount")::float8`). `DataFrame` aggregates coerce on
their own; raw `rows` and JSON/CSV exports do not.

## Parameters

```ts
await erp.sql(
  `SELECT "Customer" AS customer, SUM("Total Amount")::float8 AS amount
   FROM "Order"
   WHERE "Order Date" >= @from AND "Order Date" < @to AND "Status" = @status
   GROUP BY 1 ORDER BY 2 DESC`,
  {
    params: [
      { name: "from", type: "date" },
      { name: "to", type: "date" },
      { name: "status", type: "text", default: "paid" },
    ],
    values: { from: "2026-01-01", to: "2027-01-01" },
  },
);
```

Types: `text`, `number`, `boolean`, `date`, `datetime`. Values travel separately and
the server casts them — **never concatenate values into the SQL**. A saved query takes
its values as `dash.run(name, { from: "…" })`; a missing value falls back to `default`.

## Examples

```sql
-- by month
SELECT to_char("Order Date", 'YYYY-MM') AS month,
       SUM("Total Amount")::float8 AS revenue,
       COUNT(*) AS orders
FROM "Order" GROUP BY 1 ORDER BY 1;

-- join on a relation (an id array)
SELECT c."Customer Name" AS customer, SUM(o."Total Amount")::float8 AS amount
FROM "Order" o
JOIN "Customer" c ON c.id = ANY(o."Customer")
GROUP BY 1;

-- join on a text key
SELECT p."Product Name" AS product, SUM(o."Quantity")::float8 AS qty
FROM "Purchase Order" o
JOIN "Product" p ON o."Product Code" = p."Product Code"
GROUP BY 1 ORDER BY 2 DESC;

-- top 3 per month
SELECT * FROM (
  SELECT "Machine Name" AS machine,
         to_char("Date", 'YYYY-MM') AS month,
         SUM("Actual Output")::float8 AS output,
         ROW_NUMBER() OVER (PARTITION BY to_char("Date", 'YYYY-MM')
                            ORDER BY SUM("Actual Output") DESC) AS rank
  FROM "Production" GROUP BY 1, 2
) t WHERE rank <= 3;
```

## When not to use SQL

- Whole records — `version` for an update, `computedData`, relations → `records()`.
- More than 1,000 raw rows → `fetchAll({ max })`.
- Any write → `create` / `update` / `createMany`.
