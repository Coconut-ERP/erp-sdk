# Công thức — script chạy được

Mỗi mục là một file `.mjs` chạy bằng `node --env-file=.env <file>` (Node 20.6+),
hoặc `.ts` chạy bằng `npx tsx`. Node 18 thì tự nạp env:
`ERP_BASE_URL=… ERP_API_KEY=… node file.mjs`.

Script có ghi thì chạy hai lượt, **cùng một file, không sửa dòng nào**:

```bash
ERP_ENV=development node script.mjs   # server validate thật rồi rollback
node script.mjs                        # ưng con số rồi thì ghi thật
```

## 0. Khung chung

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

Thêm `{ resource: "object:record", action: "create" }` / `"update"` /
`"delete"` khi script có ghi — khai đúng cái dùng, sai quyền là chết ngay lúc
khởi tạo chứ không chết giữa chừng. Script chạy SQL/dashboard cần thêm quyền
trên resource `dashboard` / `dashboard:query`, script điều khiển workflow cần
`workflow` / `workflow:run` (`npx erp whoami` xem key có gì) — và import thêm
`runResult`, `runLogs`, `WORKFLOW_ENV_KEEP` từ `erp-sdk`.

## 1. Chụp schema thật ra file

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

Tương đương `npx erp schema dump`, nhưng lọc/định dạng được theo ý.

## 2. Báo cáo tổng hợp → bảng gọn

```js
const orders = await erp.object("Đơn hàng");

const df = await orders.records()
  .where("Ngày đặt", "greater_than_or_equal", "2026-01-01")
  .where("Trạng thái", "in", ["paid", "shipped"])
  .toFrame({ max: 50000 });

const byMonth = df
  .groupBy((r) => String(r["Ngày đặt"]).slice(0, 7), { as: "Tháng" })
  .agg({
    "Doanh thu": ["sum", "Tổng tiền"],
    "Số đơn": ["count"],
    "Đơn lớn nhất": ["max", "Tổng tiền"],
  })
  .sortBy("Tháng");

console.table(byMonth.toArray());
console.log("Tổng:", df.sum("Tổng tiền").toLocaleString("vi-VN"));
```

`console.table` đọc dễ hơn nhiều so với đổ JSON thô. Với báo cáo dài, in top-N
(`.head(20)`) rồi ghi bản đầy đủ ra file.

## 3. Xuất CSV (mở được bằng Excel tiếng Việt)

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
  .select("id", "Mã đơn", "Khách hàng", "Tổng tiền", "Trạng thái")
  .toArray();

writeFileSync("don-hang.csv", "﻿" + toCsv(rows), "utf8");   // BOM cho Excel
```

## 4. Nối hai bảng qua field `relation`

Field `relation` nằm trong `data` dưới dạng **mảng id**. Ba cách, chọn theo tình
huống:

```js
// (a) preload — server nạp kèm, tốt khi chỉ cần vài quan hệ mỗi dòng
const records = await orders.records().preload("Khách hàng", { limit: 3 }).fetchAll({ max: 5000 });
for (const rec of records) {
  const khach = orders.related(rec, "Khách hàng")[0];
  console.log(rec.data.code, khach?.data.name);
}

// (b) getMany — gom id rồi lấy một lần, tốt khi quan hệ trùng nhau nhiều
const customers = await erp.object("Khách hàng");
const key = orders.fieldKey("Khách hàng");
const ids = [...new Set(records.flatMap((r) => r.data[key] ?? []))];
const byId = Object.fromEntries(
  (await customers.getMany(ids)).map((c) => [c.id, customers.rowFromRecord(c)]),
);

// (c) leftJoin trên DataFrame — tốt khi cần cả hai bảng để tổng hợp
const dfOrders = (await orders.records().toFrame({ max: 20000 }))
  .map((r) => ({ ...r, customerId: (r["Khách hàng"] ?? [])[0] }));
const dfCustomers = (await customers.records().toFrame())
  .select("id", "Tên", "Khu vực")
  .rename({ id: "customerId" });

dfOrders.leftJoin(dfCustomers, "customerId")
  .groupBy("Khu vực")
  .sum("Tổng tiền", "Doanh thu")
  .sortBy("Doanh thu", "desc")
  .toArray();
```

Không bao giờ gọi `handle.get(id)` trong vòng lặp theo dòng.

## 5. Ghi link: tạo record kèm quan hệ trong **một** request

Relation là một field như mọi field khác, giá trị là mảng id — không còn cảnh
"record đã tạo nhưng link fail":

```js
const orders = await erp.object("Đơn hàng");
const lines = await erp.object("Chi tiết đơn");

// 1. tạo các dòng chi tiết trước để có id
const created = await lines.createMany([
  { "Sản phẩm": "SP-1", "Số lượng": 2 },
  { "Sản phẩm": "SP-2", "Số lượng": 1 },
]);

// 2. tạo đơn kèm link, cùng một transaction, thứ tự mảng = thứ tự hiển thị
await orders.create({
  "Mã đơn": "DH-001",
  "Chi tiết": created.records.map((r) => r.id),   // id, không phải cả record
});
```

Sửa list của một record đang có sẵn — **gửi đủ mọi id muốn giữ**, vì ghi relation
là *thay cả list*:

```js
const rec = await orders.records().where("Mã đơn", "equals", "DH-001").first();
const dangCo = orders.linkedIds(rec, "Chi tiết");        // đọc từ data

await orders.update(rec.id, { "Chi tiết": [...dangCo, idMoi] });   // thêm 1
await orders.update(rec.id, { "Chi tiết": dangCo.filter((i) => i !== idBo) }); // bớt 1
await orders.update(rec.id, { "Chi tiết": [] });                   // gỡ hết
await orders.update(rec.id, { "Trạng thái": "paid" });             // không đụng link
```

`null` = "không nói gì về field này" (link giữ nguyên), `[]` = gỡ hết. Đừng để
code tự biến `undefined` thành `[]` — đó là cách xoá link ngoài ý muốn.

Import nhiều đơn cùng lúc thì gộp luôn vào `createMany`, mỗi dòng mang link của
nó; backend gom toàn bộ id của cả request để kiểm một lượt:

```js
await orders.createMany(
  don.map((d) => ({ "Mã đơn": d.code, "Chi tiết": idChiTietCua[d.code] })),
);
```

Quan hệ **hơn 100 id** thì không ghi inline được (đọc cũng chỉ trả 100) — dùng
`createLink` / `deleteLink` từng cái:

```js
await orders.createLink(rec.id, "Chi tiết", idMoi, dangCo.length);
await orders.deleteLink(rec.id, "Chi tiết", idBo);
```

## 6. Nhập dữ liệu từ CSV/JSON

```js
import { readFileSync } from "node:fs";

const raw = JSON.parse(readFileSync("input.json", "utf8"));   // CSV có dấu ngoặc
                                                              // thì dùng parser thật
const products = await erp.object("Sản phẩm");
const known = new Set(products.fields.map((f) => f.name));

// 1. map + kiểm tra tên cột TRƯỚC khi gọi mạng
const rows = raw.map((r) => ({
  "Tên sản phẩm": String(r.name).trim(),
  "Giá bán": Number(r.price),
  "Nhóm": r.category ?? null,
}));
for (const col of Object.keys(rows[0])) {
  if (!known.has(col)) throw new Error(`Bảng không có field "${col}"`);
}

// 2. in thử 3 dòng
console.log(rows.slice(0, 3));

// 3. ghi — SDK tự chia lô 500, mỗi lô một transaction.
//    ERP_ENV=development thì lệnh này là dry run: server validate từng dòng
//    (unique, kiểu dữ liệu, id relation) rồi rollback, lỗi báo đúng dòng nào.
const result = await products.createMany(rows);
console.log(
  result.dryRun
    ? `Chạy thử OK: ${rows.length} dòng hợp lệ. Bỏ ERP_ENV rồi chạy lại để ghi thật.`
    : `Đã tạo ${result.created} record`,
);
```

Không cần cờ `APPLY=1` tự chế nữa: `ERP_ENV=development` cho **đúng** đường đi
của lệnh thật (kể cả lỗi từ server), thay vì chỉ in payload rồi thoát sớm.

## 7. Cập nhật hàng loạt an toàn

```js
const filterOf = () => orders.records().where("Trạng thái", "equals", "new");

const total = await filterOf().count();          // đếm trước, báo con số
console.log(`${total} đơn sẽ chuyển sang "processing"`);

// thử một lượt: matched là số thật, không có dòng nào bị sửa
const thu = await filterOf().update({ "Trạng thái": "processing" }, { dryRun: true });
console.log(`Chạy thử: khớp ${thu.matched}, sẽ sửa ${thu.updated}`);
if (erp.dryRun) process.exit(0);                 // ERP_ENV=development thì dừng ở đây

let done = 0;
for (;;) {
  const res = await filterOf().update({ "Trạng thái": "processing" }, { limit: 1000 });
  done += res.updated;
  console.log(`${done}/${total}`);
  if (!res.hasMore) break;
}
```

Vòng lặp này chỉ kết thúc vì bản update **làm dòng đã sửa rớt khỏi filter**. Nếu
field được set không nằm trong filter, vòng lặp sẽ chạy mãi — khi đó lấy danh
sách id trước rồi update theo lô id.

## 8. Sửa một record đúng phiên bản (tránh mất dữ liệu)

```js
import { ErpApiError } from "erp-sdk";

async function updateSafely(handle, id, patch, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    const current = await handle.get(id);
    try {
      return await handle.update(id, patch(handle.rowFromRecord(current)), current.version);
    } catch (error) {
      // 409 = ai đó vừa ghi đè: đọc lại rồi thử lại, đừng ép version
      if (!(error instanceof ErpApiError) || error.status !== 409 || attempt >= retries) throw error;
    }
  }
}

await updateSafely(orders, id, (row) => ({ "Tổng tiền": Number(row["Tổng tiền"]) + 1000 }));
```

## 9. Soi chất lượng dữ liệu

```js
const df = await orders.records().toFrame({ max: 50000 });

console.log("Thiếu khách hàng:", df.where("Khách hàng", "is_empty").count());
console.log("Theo trạng thái:", df.countBy("Trạng thái"));

// mã đơn bị trùng
const dup = Object.entries(df.countBy("Mã đơn")).filter(([, n]) => n > 1);
console.log("Trùng mã:", dup);

// giá trị bất thường
df.where("Tổng tiền", "less_than", 0).toArray().forEach((r) => console.log(r.id, r["Tổng tiền"]));
```

## 10. Chạy theo quyền của một user cụ thể

```js
const asUser = erp.asUser(accessTokenCuaUser);       // hoặc (await erp.session(initData)).client
const visible = await (await asUser.object("Đơn hàng")).records().count();
```

Client này bị cắt theo IAM permission + row scope của user đó — dùng khi cần
biết "user này thực sự nhìn thấy gì", không phải khi cần dữ liệu đầy đủ.

## 11. Báo cáo bằng SQL rồi ghép ở client

Gộp nặng để database làm, chỉ kéo về dòng đã tổng hợp:

```js
const doanhThu = (await erp.sql(`
  SELECT to_char("Ngày đặt", 'YYYY-MM') AS thang,
         "Khách hàng" AS khach,
         SUM("Tổng tiền")::float8 AS tien
  FROM "Đơn hàng"
  WHERE "Ngày đặt" >= @tu
  GROUP BY 1, 2
`, { params: [{ name: "tu", type: "date" }], values: { tu: "2026-01-01" } })).toFrame();

console.table(
  doanhThu.groupBy("thang").sum("tien", "doanhThu").sortBy("thang").toArray(),
);
```

Nhớ `::float8` — cột `numeric` về JSON là **chuỗi**. Trần 1 000 dòng, không có
cursor: nếu `r.truncated` là `true` thì câu SQL còn thiếu `GROUP BY`.

## 12. Lưu query thành dashboard cho người dùng xem

```js
const dash = await erp.dashboards.create({ name: "Vận hành", description: "Số liệu hằng ngày" });

await dash.addQuery({
  name: "Doanh thu theo tháng",
  sql: `SELECT to_char("Ngày đặt", 'YYYY-MM') AS thang,
               SUM("Tổng tiền")::float8 AS doanh_thu
        FROM "Đơn hàng" GROUP BY 1 ORDER BY 1`,
  chartType: "line",
  chartConfig: { x: "thang", y: "doanh_thu" },
});

// chạy lại bất cứ lúc nào từ script
const rows = await (await erp.dashboard("Vận hành")).run("Doanh thu theo tháng");
```

## 13. Workflow chạy 9h sáng mỗi ngày

Dựng workflow, publish, chạy thử và đọc kết quả — ví dụ đầy đủ cùng toàn bộ luật
(trigger, version/publish, env write-only) nằm ở **`references/workflows.md`**.

## Bẫy đã trả giá

- **`createdAt` / `updatedAt` không lọc và không sắp xếp được.** Filter chỉ nhận
  field thật của bảng, cộng khóa đặc biệt `id`. Muốn lọc theo thời gian thì bảng
  phải có field `date`/`datetime` của chính nó. (`rowFromRecord` vẫn trả
  `createdAt`/`updatedAt`, nên lọc phía client bằng `DataFrame` được.)
- **Query là builder có trạng thái**: `count()`/`first()` set `limit` lên chính
  nó — dựng chain mới mỗi lần dùng (xem `filterOf()` ở mục 7).
- **`fetchAll()` không có trần mặc định** — bảng lớn nhớ `{ max }`.
- **`in`/`not_in` tối đa 200 giá trị**; nhiều hơn thì chia lô, hoặc dùng
  `getMany` (đã chia lô sẵn).
- **Số ép kiểu im lặng**: `sum`/`avg` biến chuỗi không parse được thành `0`.
  Kiểm bằng `df.where("Cột", "is_empty").count()` trước khi tin con số.
- **Đọc ra 0 dòng** thường là row scope của IAM chứ không phải filter sai —
  `npx erp whoami` xem quyền thật.
- **Field computed** (`formula`, `lookup`, `rollup`) nằm ở `computedData`, chỉ
  đọc, và do worker tính nền — có thể chưa cập nhật ngay sau khi ghi.
- **Đổi cấu trúc bảng xong phải `erp.invalidate()`**, nếu không handle cache còn
  giữ danh sách field cũ.
- **Ghi relation là thay cả list, không phải thêm**: gửi thiếu id = gỡ link. Đọc
  `linkedIds()` rồi gửi lại đủ.
- **`get(id)` không trả relation** — muốn mảng id thì lấy record bằng
  `records().…` (query), hoặc `preload`.
- **Id trả về từ dry-run create là id giả** (`ERP_ENV=development`): đừng lưu,
  đừng dùng làm khoá cho bước sau. Muốn có id thật thì phải chạy thật.
- **`delete` không có dry run**: ở chế độ development nó ném
  `DryRunUnsupportedError` chứ không xoá — đó là chủ ý. `workflow.run()` cũng
  vậy: chạy workflow là ghi thật.
- **SQL phân biệt hoa thường** ở tên bảng/cột, trần 1 000 dòng, không cursor —
  và cột `numeric` trả về **chuỗi** (`::float8` để ra số).
- **Sửa workflow xong quên `publish()`** → run vẫn chạy bản cũ. Và `setEnv` thay
  cả map: tên nào không gửi là mất.
- **`erp.dashboards.list()` phân trang trước khi lọc quyền** — trang ngắn không
  có nghĩa là hết, dùng `listAll()`.
