# 11 — Truy vấn SQL & dashboard

[← CLI & AI agent](10-cli-va-ai-agent.md) · [Mục lục](README.md) · [Tiếp: Workflow →](12-workflow.md)

`RecordQuery` lọc và phân trang trên **một** bảng. Khi câu hỏi là "doanh thu
theo tháng theo khách hàng", "join ba bảng rồi xếp hạng", "đếm phân phối theo
trạng thái" thì đó là việc của SQL: một câu `SELECT` chạy **read-only** ngay
trong database, trả về cột và dòng đã tổng hợp sẵn.

Cùng một cơ chế phục vụ hai nhu cầu:

- **SQL tạm** — `erp.sql(...)`: chạy một câu, lấy kết quả, không lưu gì.
- **Query đã lưu** — nằm trong một **dashboard**, có tên, có tham số, có kiểu
  biểu đồ; frontend ERP vẽ nó, còn SDK chạy lại được bất cứ lúc nào.

## 1. Bảng là **tên hiển thị**, cột cũng vậy

Đây là điểm quan trọng nhất. SQL ở đây **không** chạy trên bảng vật lý của
engine — server dịch mỗi tên object thành một CTE, mỗi field thành một cột theo
đúng **display name**:

```ts
const rows = await erp.sql(`
  SELECT "Tên chuyền" AS chuyen, SUM("Sản lượng thực tế") AS actual
  FROM "Sản xuất"
  WHERE "Tên chuyền" IS NOT NULL
  GROUP BY 1
  ORDER BY 2 DESC
`);
rows.columns;   // ["chuyen", "actual"]
rows.rows;      // [{ chuyen: "C1,2", actual: "181225" }, …]
```

Vài quy tắc đi kèm:

- **Phân biệt hoa thường.** `FROM "sản xuất"` → 400
  `Unknown table "sản xuất"`. Lấy tên đúng bằng `npx erp objects list`.
- Luôn đặt trong nháy kép: tên có dấu và khoảng trắng.
  `quoteIdentifier("Đơn hàng")` → `"Đơn hàng"` khi phải ghép chuỗi SQL.
- Ngoài field, mỗi object còn ba cột hệ thống: `id`, `created_at`,
  `updated_at` (`QUERY_SYSTEM_COLUMNS`).
- Field `relation` ra dưới dạng **mảng uuid**, field computed
  (`formula`/`lookup`/`rollup`) đọc như cột bình thường.
- Chỉ với bảng của workspace: `pg_catalog`, `information_schema`… bị chặn.
- `@workspace_id` (`WORKSPACE_ID_PARAM`) luôn có sẵn, đúng workspace đang gọi.

`compiledSql` trong kết quả cho xem chính xác câu server đã chạy — hữu ích khi
muốn biết một field được dịch thành gì.

## 2. Giới hạn phải nhớ

| Giới hạn | Chi tiết |
| --- | --- |
| **Một câu `SELECT`** | `WITH … SELECT` được; `;` rồi câu thứ hai → 400. Không INSERT/UPDATE/DELETE/DDL (chạy trong transaction read-only) |
| **1 000 dòng** | Cắt cứng, `truncated: true`. Không có cursor — **tổng hợp trong SQL**, đừng phân trang bằng SQL |
| **20 tham số** | `@name` khai trong `params` |
| **SQL ≤ 20 000 ký tự** | |
| **Row scope vẫn áp dụng** | Bảng được kiểm quyền và lọc dòng theo quyền record của chính người gọi — hai người chạy cùng câu có thể ra hai kết quả |

SDK chặn trước hai lỗi đầu bằng `SqlQueryError` (không tốn round trip).

**Bẫy kiểu dữ liệu:** cột `numeric` của Postgres về JSON là **chuỗi** —
`SUM("Tổng tiền")` trả `"327970"`, không phải `327970`. Ép ngay trong SQL:

```sql
SUM("Sản lượng thực tế")::float8 AS actual   -- → number
COUNT(*) AS n                                 -- bigint → number sẵn
```

`DataFrame` tự ép số khi tính (`sum`, `avg`, `sortBy`), nên chỉ cần bận tâm khi
đọc thẳng `rows` hoặc xuất JSON.

## 3. Kết quả: `QueryResult`

```ts
const r = await erp.sql('SELECT COUNT(*) AS n FROM "PO"');

r.columns;        // string[]
r.rows;           // Record<string, unknown>[]
r.rowCount;       // số dòng trả về
r.truncated;      // true nếu đã bị cắt ở 1 000
r.compiledSql;    // câu SQL thật server chạy

r.value<number>();          // 129 — ô đầu tiên (query scalar)
r.value("n");               // theo tên cột
r.column("n");              // cả cột thành mảng
r.toFrame();                // → DataFrame, ghép tiếp với dữ liệu khác
```

`toFrame()` là cầu nối tự nhiên: gộp nặng bằng SQL, rồi `leftJoin`/`map`/xuất
CSV bằng [DataFrame](04-dataframe.md).

## 4. Tham số `@name`

Tham số vừa để tái sử dụng câu query, vừa để **không nối chuỗi vào SQL** (giá
trị đi riêng, không phải text ghép vào câu lệnh):

```ts
const r = await erp.sql(
  `SELECT "Tên chuyền" AS chuyen, SUM("Sản lượng thực tế")::float8 AS actual
   FROM "Sản xuất"
   WHERE "Ngày" >= @tu AND "Ngày" < @den
   GROUP BY 1`,
  {
    params: [
      { name: "tu",  type: "date", label: "Từ ngày" },
      { name: "den", type: "date", default: "2027-01-01" },
    ],
    values: { tu: "2026-01-01" },   // thiếu → dùng default
  },
);
```

`type`: `text` · `number` · `boolean` · `date` · `datetime`. Server ép kiểu
theo khai báo (`(@param)::date`), nên khai sai kiểu là lỗi SQL chứ không phải
âm thầm sai kết quả.

## 5. Dashboard và query đã lưu

```ts
const dashboards = await erp.dashboards.listAll();

const dash = await erp.dashboard("Monitor sản xuất - CEO");  // tên hoặc id
(await dash.queries()).map((q) => q.name);

const r  = await dash.run("Tổng sản lượng thực tế");             // → QueryResult
const df = await dash.toFrame("Sản lượng theo chuyền", { thang: "2026-08" });
```

Tạo và sửa:

```ts
const dash = await erp.dashboards.create({ name: "Vận hành", description: "…" });

await dash.addQuery({
  name: "Đơn theo tháng",
  sql: `SELECT to_char("Ngày đặt", 'YYYY-MM') AS thang,
               SUM("Tổng tiền")::float8 AS doanh_thu
        FROM "Đơn hàng" GROUP BY 1 ORDER BY 1`,
  chartType: "line",
  chartConfig: { x: "thang", y: "doanh_thu" },
});

await dash.updateQuery("Đơn theo tháng", { chartType: "bar" });
await dash.deleteQuery("Đơn theo tháng");
await dash.update({ name: "Vận hành 2026" });
await dash.delete();          // xoá dashboard là xoá luôn mọi query trong đó
```

`chartType`: `table` · `number` · `line` · `bar` · `area` · `pie` ·
`composed` · `scatter` · `radar` · `radial_bar` · `funnel` · `treemap` ·
`sankey` · `sunburst` (`CHART_TYPES`). `chartConfig` là thứ frontend ERP đọc để
vẽ — thường là `{ x, y, series?, layout? }`, riêng `number` dùng
`{ valueColumn, format, precision, prefix, suffix }`. SDK không kiểm nội dung
`chartConfig`, ai vẽ nấy quy ước.

Query đã lưu resolve theo **tên** y như object: id → tên chính xác → tên không
phân biệt hoa thường; sai tên thì `UnknownQueryError.known` liệt kê tên đúng.

### Phân trang danh sách dashboard

`GET /dashboards` phân trang **trước** khi lọc theo quyền chia sẻ, nên một
trang ngắn (kể cả rỗng) **không** có nghĩa là hết:

```ts
const { dashboards, meta } = await erp.dashboards.list({ page: 1, perPage: 50 });
meta;   // { page, perPage, totalItems, totalPages } — totalItems tính cả cái bị ẩn
const all = await erp.dashboards.listAll();   // đi hết theo meta.totalPages
```

## 6. Chia sẻ

Dashboard mặc định là `workspace` (ai trong workspace cũng đọc được) hoặc
`restricted` (chỉ những người được cấp):

```ts
await dash.sharing();                       // { visibility, entries }
await dash.setSharing("restricted", [
  { subjectType: "user",  subjectId: userId,  access: "manage" },
  { subjectType: "group", subjectId: groupId, access: "read" },
  { subjectType: "role",  subjectId: "admin", access: "write" },
]);
await dash.setSharing("workspace");         // entries chỉ nhận khi restricted
```

Cần quyền `manage` trên chính dashboard đó. Lưu ý: chia sẻ dashboard **không**
mở thêm dữ liệu — câu query vẫn chạy theo row scope của người bấm chạy.

## 7. Khi nào SQL, khi nào `RecordQuery`

| Việc | Dùng |
| --- | --- |
| Lấy/sửa record, ghi dữ liệu | `RecordQuery` / `ObjectHandle` — SQL ở đây **chỉ đọc** |
| Lọc đơn giản, cần `RecordDto` đầy đủ (version, computed, relation) | `RecordQuery` |
| `GROUP BY`, `JOIN`, `window function`, xếp hạng, phân phối | `erp.sql` |
| Số liệu cho dashboard người dùng xem | Query lưu trong dashboard |
| Kéo vài nghìn dòng thô về xử lý ở client | `fetchAll()` / `toFrame()` — SQL cắt ở 1 000 |

Quyền IAM đi theo hai resource `dashboard` và `dashboard:query`, action
`create`/`read`/`update`/`delete`; chạy query còn cần quyền đọc record của các
bảng nó động tới. Xem key hiện tại có gì: `npx erp whoami`, hoặc
`npx erp doctor --require dashboard:query:read`.

---

[← CLI & AI agent](10-cli-va-ai-agent.md) · [Mục lục](README.md) · [Tiếp: Workflow →](12-workflow.md)
