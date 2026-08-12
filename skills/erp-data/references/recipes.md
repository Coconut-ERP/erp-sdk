# Công thức — script chạy được

Mỗi mục là một file `.mjs` chạy bằng `node --env-file=.env <file>` (Node 20.6+),
hoặc `.ts` chạy bằng `npx tsx`. Node 18 thì tự nạp env:
`ERP_BASE_URL=… ERP_API_KEY=… node file.mjs`.

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
khởi tạo chứ không chết giữa chừng.

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

## 5. Nhập dữ liệu từ CSV/JSON

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

// 2. in thử 3 dòng, dừng lại nếu chạy dry-run
console.log(rows.slice(0, 3));
if (process.env.APPLY !== "1") {
  console.log(`Dry run: ${rows.length} dòng sẽ được tạo. Chạy lại với APPLY=1.`);
  process.exit(0);
}

// 3. ghi thật — SDK tự chia lô 500, mỗi lô một transaction
const result = await products.createMany(rows);
console.log(`Đã tạo ${result.created} record`);
```

Cờ `APPLY=1` là mặc định tốt cho mọi script ghi: chạy lần đầu luôn là dry run.

## 6. Cập nhật hàng loạt an toàn

```js
const filterOf = () => orders.records().where("Trạng thái", "equals", "new");

const total = await filterOf().count();          // đếm trước, báo con số
console.log(`${total} đơn sẽ chuyển sang "processing"`);
if (process.env.APPLY !== "1") process.exit(0);

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

## 7. Sửa một record đúng phiên bản (tránh mất dữ liệu)

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

## 8. Soi chất lượng dữ liệu

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

## 9. Chạy theo quyền của một user cụ thể

```js
const asUser = erp.asUser(accessTokenCuaUser);       // hoặc (await erp.session(initData)).client
const visible = await (await asUser.object("Đơn hàng")).records().count();
```

Client này bị cắt theo IAM permission + row scope của user đó — dùng khi cần
biết "user này thực sự nhìn thấy gì", không phải khi cần dữ liệu đầy đủ.

## Bẫy đã trả giá

- **`createdAt` / `updatedAt` không lọc và không sắp xếp được.** Filter chỉ nhận
  field thật của bảng, cộng khóa đặc biệt `id`. Muốn lọc theo thời gian thì bảng
  phải có field `date`/`datetime` của chính nó. (`rowFromRecord` vẫn trả
  `createdAt`/`updatedAt`, nên lọc phía client bằng `DataFrame` được.)
- **Query là builder có trạng thái**: `count()`/`first()` set `limit` lên chính
  nó — dựng chain mới mỗi lần dùng (xem `filterOf()` ở mục 6).
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
