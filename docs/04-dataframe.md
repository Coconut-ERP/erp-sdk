# 04 — DataFrame: phân tích dữ liệu kiểu pandas

[← Dữ liệu](03-du-lieu.md) · [Mục lục](README.md) · [Tiếp: Danh tính người dùng →](05-danh-tinh-nguoi-dung.md)

Khi app cần thống kê/báo cáo, `toFrame()` kéo toàn bộ record khớp query về
và bọc trong `DataFrame` — immutable, chain thoải mái, backed bằng lodash.

```ts
const df = await invoices
  .records()
  .where("Trạng thái", "equals", "approved")
  .toFrame();                     // cột = tên hiển thị field
// toFrame({ by: "key" })         // cột = field key
// toFrame({ max: 5000 })         // chặn số record kéo về
```

Mỗi row có thêm `id`, `version`, `createdAt`, `updatedAt`; field computed đã
merge sẵn. **Lưu ý:** `toFrame()` = `fetchAll()` — bảng rất lớn thì filter
phía server trước và/hoặc đặt `max`.

## Xem nhanh & chọn lọc

```ts
df.count();  df.isEmpty();
df.first();  df.last();  df.at(-1);
df.head(10).toArray();  df.tail(5).toArray();  df.slice(10, 20);

df.where("Tổng tiền", "greater_than", 1_000_000)   // cùng bộ toán tử với query server
  .where("Trạng thái", "in", ["approved", "paid"]) // in/not_in nhận mảng, như server
  .filter((row) => String(row["Khách hàng"]).startsWith("A"))  // predicate tuỳ ý
  .select("Khách hàng", "Tổng tiền")
  .rename({ "Tổng tiền": "revenue" })
  .sortBy("revenue", "desc")
  .toArray();

df.map((row) => ({ ...row, vat: Number(row["Tổng tiền"]) * 0.1 }));
df.pluck("Khách hàng");            // mảng giá trị một cột
df.unique();  df.uniqueBy("Khách hàng");
```

## Tổng hợp

```ts
df.sum("Tổng tiền");   df.avg("Tổng tiền");   // avg trả null nếu frame rỗng
df.min("Tổng tiền");   df.max("Tổng tiền");
df.countBy("Trạng thái");   // { approved: 12, pending: 3 }
df.keyBy("id");             // { <id>: row }
```

Giá trị không phải số được ép kiểu: `Number(value)`, `true`→1, không parse
được→0.

## groupBy + agg

```ts
df.groupBy("Khách hàng")
  .agg({
    revenue: ["sum", "Tổng tiền"],
    orders:  ["count"],
    biggest: ["max", "Tổng tiền"],
    // hoặc hàm tuỳ ý:
    lastDate: (rows) => rows.map((r) => r["Từ ngày"]).sort().at(-1),
  })
  .sortBy("revenue", "desc")
  .head(5)
  .toArray();
// [{ "Khách hàng": "An", revenue: 300, orders: 2, ... }, ...]
```

Shortcut: `.groupBy(f).count()` / `.sum(field)` / `.avg(field)`. Đổi tên cột
khoá nhóm bằng `groupBy(field, { as: "tên_cột" })`; nhóm theo hàm cũng được
(`groupBy((r) => String(r["Từ ngày"]).slice(0, 7))` — theo tháng). Cần từng
nhóm dưới dạng frame riêng: `.frames()` → `Map<string, DataFrame>`.

## Join hai bảng

```ts
const invoicesDf  = await invoices.records().toFrame();
const customersDf = await (await app.object("Khách hàng")).records().toFrame();

invoicesDf.leftJoin(customersDf, "Khách hàng", "Tên", { prefix: "kh_" });
// mỗi row hoá đơn được gắn thêm cột của khách hàng khớp, prefix "kh_"
```

Left join: không khớp thì giữ nguyên row trái; cột trùng tên không bị ghi đè
(dùng `prefix` để tránh va chạm).

## Ví dụ trọn: báo cáo nghỉ phép theo người, theo tháng

```ts
const leaves = await app.object("Đơn xin nghỉ");
const df = await leaves.records().where("Trạng thái", "equals", "approved").toFrame();

const byPerson = df.groupBy("Người xin nghỉ").count().sortBy("count", "desc").toArray();
const byMonth = df
  .groupBy((r) => String(r["Từ ngày"]).slice(0, 7), { as: "month" })
  .count()
  .sortBy("month")
  .toArray();
```

Toàn bộ API: xem [08 — API reference](08-api-reference.md#dataframe).

---

[← Dữ liệu](03-du-lieu.md) · [Mục lục](README.md) · [Tiếp: Danh tính người dùng →](05-danh-tinh-nguoi-dung.md)
