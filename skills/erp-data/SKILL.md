---
name: erp-data
description: Đọc, ghi, truy vấn SQL, phân tích dữ liệu và chạy workflow trên workspace ERP 1kk bằng erp-sdk (TypeScript/JavaScript). Dùng khi task nhắc tới erp-sdk, ErpClient, ObjectHandle, RecordQuery, DataFrame, erp.sql / dashboard / query đã lưu / biểu đồ, workflow / cron / publish / run trên ERP, ERP_API_KEY / erp_sk_, ERP_ENV / dryRun / chạy thử trước khi ghi, link–relation giữa hai bảng, object–field–record của ERP, hoặc khi người dùng muốn lấy/thống kê/nhập/sửa dữ liệu trên ERP ("lấy danh sách đơn hàng từ ERP", "báo cáo doanh thu theo tháng", "gộp theo tháng bằng SQL", "tạo dashboard", "chạy script định kỳ mỗi sáng", "import CSV vào bảng", "cập nhật hàng loạt", "join hai bảng", "xuất Excel/CSV từ ERP"). Dựng web app dùng ERP làm backend (schema.json, initData, deploy) thì dùng skill erp-miniapp.
---

# Khai thác dữ liệu ERP bằng erp-sdk

ERP 1kk lưu dữ liệu trong **object engine**: object (bảng) → field (cột) →
record (dòng). `erp-sdk` là lớp TypeScript trên REST API đó.

**Cách làm mặc định: viết một script chạy được rồi chạy nó.** CLI `erp` chỉ để
dựng môi trường và xem schema thật — mọi thao tác đọc/ghi/phân tích đều viết
bằng SDK, vì logic nhiều bước (join, tổng hợp, đếm trước khi ghi) không diễn đạt
được bằng cờ dòng lệnh.

**Hai luật không được quên:**

1. **Tên object/field là địa chỉ dữ liệu.** Đoán sai → `UnknownObjectError` /
   `UnknownFieldError` lúc chạy. Lấy schema thật trước khi viết code (§2).
2. **Script có ghi thì chạy thử trước** bằng `ERP_ENV=development` (§7) — cùng
   một file, không sửa dòng nào. Đây là dữ liệu thật của người dùng.

## 1. Kết nối

```bash
npm install https://github.com/Coconut-ERP/erp-sdk/releases/download/v0.4.1/erp-sdk.tgz
npx erp doctor        # env + kết nối + quyền → {ok, checks[]}, exit 1 nếu hỏng
```

```
ERP_BASE_URL=https://erp.example.com
ERP_API_KEY=erp_sk_...
ERP_ENV=development     # tùy chọn — mọi lệnh ghi record thành dry run
```

Chưa có credential thì **dừng lại hỏi người dùng** — đừng đoán URL/key, cũng
đừng đoán tên bảng.

```ts
import { createMiniApp } from "erp-sdk";

const erp = await createMiniApp({
  baseUrl: process.env.ERP_BASE_URL,
  apiKey: process.env.ERP_API_KEY,
  permissions: [                       // preflight: thiếu quyền là chết ngay đây
    { resource: "object", action: "read" },
    { resource: "object:field", action: "read" },
    { resource: "object:record", action: "read" },
  ],
});
```

Thêm `object:record` + `create`/`update`/`delete` khi script có ghi; `dashboard`
cho SQL; `workflow` cho automation. Chạy: `node --env-file=.env script.mjs`
(Node 20.6+) hoặc `npx tsx script.ts`. Đặt script ở thư mục tạm, đừng rải vào
source người dùng.

## 2. Xem schema thật trước

```bash
npx erp objects list                      # có bảng nào
npx erp objects show "Đơn hàng"           # field nào, type gì, config ra sao
npx erp schema dump --out workspace.json  # toàn bộ, nạp làm context
```

Đọc kỹ `type` và `config`: `relation` trỏ bảng nào, `single_select` có `options`
gì, `source: "workspace_users"` nghĩa là giá trị lưu **user id**.

## 3. Đọc

```ts
const orders = await erp.object("Đơn hàng");        // theo tên hiển thị hoặc id

await orders.records()
  .where("Trạng thái", "equals", "paid")
  .orderBy("Tổng tiền", "desc")
  .limit(50).withTotal().fetch();                   // { records, nextCursor, hasMore, total }

await orders.records().where(…).fetchAll({ max: 5000 });   // tự đi hết cursor
await orders.records().where(…).first();
await orders.records().where(…).count();
```

Giới hạn server: **20 filter, 3 sort, 100 record/trang**, `in`/`not_in` tối đa
**200 giá trị**. Toán tử và chữ ký đầy đủ: `references/api.md`.

## 4. Quan hệ — đừng N+1

Field `relation` nằm trong `data` dưới dạng **mảng id**. Ba cách, theo thứ tự
nên dùng: `preload()` (server nạp kèm) → `getMany(ids)` (1 request/200 id) →
`leftJoin` trên DataFrame. **Không bao giờ gọi `handle.get(id)` trong vòng lặp.**

## 5. Phân tích: DataFrame

`toFrame()` = `fetchAll()` + đổi sang dòng phẳng, cột theo **tên hiển thị**.
Frame bất biến, mọi method trả frame mới.

```ts
const df = await orders.records().where(…).toFrame({ max: 20000 });

df.groupBy("Khách hàng")
  .agg({ doanhThu: ["sum", "Tổng tiền"], soDon: ["count"] })
  .sortBy("doanhThu", "desc").head(10).toArray();
```

Báo cáo thì `console.table` bản rút gọn — đừng đổ hàng nghìn dòng ra stdout.

## 6. Tổng hợp nặng: SQL read-only

`RecordQuery` chỉ lọc trên **một** bảng. `GROUP BY`, `JOIN`, xếp hạng — viết SQL,
chỉ kéo về kết quả đã gộp:

```ts
const df = (await erp.sql(`
  SELECT "Khách hàng" AS kh, SUM("Tổng tiền")::float8 AS doanh_thu
  FROM "Đơn hàng" WHERE "Ngày đặt" >= @tu
  GROUP BY 1 ORDER BY 2 DESC
`, { params: [{ name: "tu", type: "date" }], values: { tu: "2026-01-01" } })).toFrame();
```

Bảng/cột là tên hiển thị, **phân biệt hoa thường**, phải trong nháy kép. Một câu
`SELECT`, trần **1 000 dòng**, không cursor → gộp trong SQL. Cột `numeric` về
JSON là **chuỗi** — `::float8` nếu cần số. Cú pháp, tham số, câu mẫu:
`references/sql.md`.

## 7. Ghi — và chạy thử trước

```ts
await orders.create({ "Mã đơn": "DH-001", "Tổng tiền": 500000 });
await orders.createMany(rows);                       // tự chia lô 500
await orders.update(id, { "Trạng thái": "paid" });   // tự đọc version
await orders.records().where(…).update(patch, { limit: 1000 });   // bulk
```

`ERP_ENV=development` làm **mọi lệnh ghi record** thành dry run: server chạy
đúng câu lệnh thật (validate, unique, version, id relation, rule) rồi
**rollback**. Sai thì lỗi y hệt lúc chạy thật; đúng thì không để lại dấu vết.

```bash
ERP_ENV=development node script.mjs   # thử toàn bộ
node script.mjs                        # ưng con số rồi thì ghi thật
```

`delete`, `restore`, `createLink`, `deleteLink`, `workflow.run()` **không có**
dry run — trong chế độ development chúng ném `DryRunUnsupportedError` chứ không
làm lén. **Id trả về từ dry-run create là id giả**, chưa từng lưu.

**Quy trình bắt buộc khi được giao việc ghi hàng loạt:**

1. `.count()` đúng filter đó trước, **báo con số cho người dùng**.
2. Chạy `ERP_ENV=development`, báo `matched`/`created` và lỗi nếu có.
3. Thao tác lớn hoặc phá huỷ (bulk update, xoá, đổi trạng thái hàng loạt):
   **hỏi xác nhận** rồi mới chạy thật.

### Ghi relation = thay cả list

| Gửi gì | Kết quả |
| --- | --- |
| không có key trong `data` | link giữ nguyên |
| `"Chi tiết": null` | **giống hệt không gửi key** — link giữ nguyên |
| `"Chi tiết": [a, b]` | link **đúng** a, b; link cũ khác biến mất |
| `"Chi tiết": []` | **xoá sạch link** của field đó |

Ngược với field thường (ở đó `null` là *xoá giá trị*). Thêm 1 link vào record
đang có 3 link = gửi cả 4 id: `[...orders.linkedIds(rec, "Chi tiết"), idMoi]`.
Tối đa **100 id/field/record**; dài hơn phải `createLink`/`deleteLink` từng cái.

## 8. Workflow — script chạy trên server ERP

Việc chạy **định kỳ** (nhắc hạn mỗi sáng, đồng bộ hằng đêm) không cần dựng
service riêng: workflow là một file TypeScript có `async function main(input)`,
ERP giữ code, secret và lịch chạy.

```ts
const wf = await erp.workflows.create({ name, code, trigger: { type: "cron",
  config: { schedule: "0 0 9 * * *", timezone: "Asia/Ho_Chi_Minh" } } });
await wf.publish();          // ⚠ chưa publish thì run vẫn ra bản cũ
```

Bốn thứ hay sai: chỉ có `manual`/`cron` (không webhook); cron **6 trường có
giây**; **sửa gì cũng về draft** phải publish lại; `setEnv` **thay cả map**.
Chi tiết quản lý workflow: `references/workflows.md`.

**Viết hoặc sửa code bên trong `main()`** — sandbox của runner, module nào import
được, trần 60s/256KB, `check`/`test-run` để thử mà không tạo draft → dùng skill
**`erp-workflow`**.

Trước khi tạo/sửa/xoá workflow của người dùng: **hỏi**. Đó là thứ chạy định kỳ
trên dữ liệu thật.

## Bẫy đã trả giá

- **`RecordQuery` là builder có trạng thái**: `count()`/`first()` set `limit` lên
  chính nó — dựng chain mới mỗi lần dùng.
- **`fetchAll()` không có trần mặc định** — bảng lớn nhớ `{ max }`.
- **Đọc ra 0 dòng** thường là row scope IAM, không phải filter sai (`npx erp whoami`).
- **`createdAt`/`updatedAt` không lọc và không sắp xếp được** — filter chỉ nhận
  field thật của bảng, cộng khoá đặc biệt `id`.
- **`get(id)` không trả relation** — muốn mảng id thì query, hoặc `preload`.
- **Field computed** (`formula`/`lookup`/`rollup`) ở `computedData`, do worker
  tính nền, có thể chưa xong ngay sau khi ghi.
- **`sum`/`avg` ép chuỗi không parse được thành `0`** — kiểm cột trước khi tin số.
- **Đổi cấu trúc bảng xong phải `erp.invalidate()`**, không thì cache còn field cũ.
- **`erp.dashboards.list()` phân trang trước khi lọc quyền** — dùng `listAll()`.

## Quyền và ranh giới

Key `erp_sk_…` là **service account**, thường ở mức `member`: đọc/ghi record
được, **tạo bảng/field thì không** (403). Muốn tạo bảng phải dùng key admin —
mặc định đừng tự làm, **hỏi người dùng trước**. Cần chạy theo quyền một user cụ
thể: `erp.asUser(accessToken)`.

**API key chỉ ở server.** Không log, không commit, không ship xuống browser,
không viết vào file kết quả.

## Tham chiếu

- `references/api.md` — bề mặt SDK cho việc dữ liệu: chữ ký, kiểu, giới hạn, error.
- `references/recipes.md` — script mẫu chạy được: báo cáo, join, import CSV,
  cập nhật hàng loạt an toàn, xuất CSV, soi chất lượng dữ liệu.
- `references/sql.md` — viết SQL cho ERP: tên bảng/cột, tham số, kiểu trả về, câu mẫu.
- `references/workflows.md` — workflow đầy đủ: trigger, version/publish, env,
  run và đọc kết quả.
- Viết **code chạy trong workflow** (runtime, module cho phép, giới hạn,
  `test-run`) → skill **`erp-workflow`**.
- Dựng **mini app** (web app dùng ERP làm backend, `schema.json`, initData,
  deploy) → skill **`erp-miniapp`**.
