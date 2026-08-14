# Viết SQL cho ERP

`erp.sql(sql, { params, values })` chạy **một** câu `SELECT` read-only trong
database của workspace và trả `{ columns, rows, rowCount, truncated, compiledSql }`.

## Bảng và cột là tên hiển thị

Server dịch mỗi object thành một CTE có tên là **display name** của nó, mỗi
field thành một cột có tên là display name của field:

```sql
SELECT "Tên chuyền", "Sản lượng thực tế" FROM "Sản xuất"
```

| Quy tắc | Chi tiết |
| --- | --- |
| Nháy kép | Bắt buộc — tên có dấu, có khoảng trắng |
| **Phân biệt hoa thường** | `FROM "sản xuất"` → 400 `Unknown table`. Lấy tên đúng: `npx erp objects list` |
| Cột hệ thống | Mọi bảng có thêm `id`, `created_at`, `updated_at` |
| Field computed | `formula`/`lookup`/`rollup` đọc như cột thường |
| Field `relation` | Ra dưới dạng **mảng uuid** (`uuid[]`) |
| Chỉ bảng workspace | `pg_catalog`, `information_schema`… bị chặn |
| `@workspace_id` | Luôn có sẵn, đúng workspace của credential đang dùng |

`compiledSql` trong kết quả cho xem câu server thực sự chạy — dùng để hiểu một
field được dịch thành gì.

## Luật của endpoint

- **Một câu.** `WITH … SELECT` được; `;` rồi câu thứ hai → 400. `(SELECT …)
  UNION ALL (SELECT …)` bị từ chối vì không bắt đầu bằng `SELECT` — bỏ ngoặc đi.
- **Read-only.** INSERT/UPDATE/DELETE/DDL đều bị từ chối; ghi dữ liệu là việc
  của `ObjectHandle`.
- **Trần 1 000 dòng**, `truncated: true` khi bị cắt, **không có cursor**.
  → Tổng hợp trong SQL. Cần dữ liệu thô nhiều hơn thì dùng
  `records().fetchAll()`.
- SQL ≤ 20 000 ký tự, ≤ 20 tham số.
- Row scope của người gọi vẫn áp dụng — kết quả có thể khác nhau theo người chạy.

## Kiểu dữ liệu trả về

| Postgres | JSON |
| --- | --- |
| `numeric` (mọi field kiểu số, `SUM`, `AVG`) | **chuỗi** — `"327970"` |
| `::float8`, `::int`, `COUNT(*)` | number |
| `timestamptz` | chuỗi ISO `"2026-08-12T00:00:00Z"` |
| `uuid[]` (relation) | chuỗi `"{uuid,uuid}"` |

Ép ngay trong SQL cho gọn:

```sql
SUM("Tổng tiền")::float8 AS doanh_thu
AVG("Sản lượng thực tế")::float8 AS trung_binh
```

`DataFrame` tự ép số khi `sum`/`avg`/`sortBy`, nên chỉ cần bận tâm khi đọc thẳng
`rows` hoặc xuất JSON/CSV.

## Tham số

```ts
await erp.sql(
  `SELECT "Khách hàng" AS kh, SUM("Tổng tiền")::float8 AS tien
   FROM "Đơn hàng"
   WHERE "Ngày đặt" >= @tu AND "Ngày đặt" < @den AND "Trạng thái" = @tt
   GROUP BY 1 ORDER BY 2 DESC`,
  {
    params: [
      { name: "tu",  type: "date" },
      { name: "den", type: "date" },
      { name: "tt",  type: "text", default: "paid" },
    ],
    values: { tu: "2026-01-01", den: "2027-01-01" },
  },
);
```

`type`: `text` · `number` · `boolean` · `date` · `datetime`. Server ép kiểu theo
khai báo, giá trị đi riêng khỏi câu lệnh — **đừng nối chuỗi giá trị vào SQL**.
Với query đã lưu, giá trị truyền ở `dash.run(name, { tu: "…" })`; tham số thiếu
thì dùng `default`.

## Câu mẫu

```sql
-- gộp theo tháng
SELECT to_char("Ngày đặt", 'YYYY-MM') AS thang,
       SUM("Tổng tiền")::float8 AS doanh_thu,
       COUNT(*) AS so_don
FROM "Đơn hàng"
GROUP BY 1 ORDER BY 1;

-- join hai bảng theo field text
SELECT sp."Tên KH" AS khach_hang, SUM(po."Số lượng")::float8 AS so_luong
FROM "PO" po
JOIN "Sản phẩm" sp ON po."Tên Hàng" = sp."Mã sản phẩm"
GROUP BY 1 ORDER BY 2 DESC;

-- join qua field relation (relation là mảng uuid)
SELECT c."Tên khách" AS khach, SUM(d."Tổng tiền")::float8 AS tien
FROM "Đơn hàng" d
JOIN "Khách hàng" c ON c.id = ANY(d."Khách hàng")
GROUP BY 1;

-- xếp hạng trong nhóm
SELECT * FROM (
  SELECT "Tên chuyền" AS chuyen,
         to_char("Ngày", 'YYYY-MM') AS thang,
         SUM("Sản lượng thực tế")::float8 AS actual,
         ROW_NUMBER() OVER (PARTITION BY to_char("Ngày", 'YYYY-MM')
                            ORDER BY SUM("Sản lượng thực tế") DESC) AS hang
  FROM "Sản xuất" GROUP BY 1, 2
) t WHERE hang <= 3;

-- phân phối theo trạng thái
SELECT "Trạng thái" AS tt, COUNT(*) AS n
FROM "Đơn hàng" GROUP BY 1 ORDER BY 2 DESC;
```

## Khi nào KHÔNG dùng SQL

- Cần `RecordDto` đầy đủ (version để update, `computedData`, relation dạng mảng
  id) → `records()`.
- Cần > 1 000 dòng thô → `fetchAll({ max })`.
- Ghi dữ liệu → `create` / `update` / `createMany`.
