# Viết code workflow — mẫu chạy được

Mọi đoạn dưới đây là **nội dung file workflow**: không import `erp`, không
`createMiniApp`, không `process.exit`. Tên bảng/field là ví dụ — lấy tên thật
bằng `npx erp objects show "<Bảng>"` trước khi viết.

## Khung mặc định

```ts
async function main(input) {
  const started = Date.now();
  const done = [];
  const failed = [];

  const orders = await erp.object("Đơn hàng");
  const rows = await orders.records()
    .where("Trạng thái", "equals", "new")
    .where("Đã nhắc", "equals", false)          // ① chọn việc theo trạng thái
    .limit(100)                                  // ② luôn có trần
    .fetchAll({ max: 200 });

  for (const row of rows) {
    try {
      await orders.update(row.id, { "Đã nhắc": true });   // ③ đánh dấu ngay
      done.push(row.id);
    } catch (e) {
      failed.push({ id: row.id, error: String(e?.message ?? e) });  // ④ không throw cả run
    }
  }

  console.log(`xong ${done.length}, lỗi ${failed.length}`);
  return { done: done.length, failed, durationMs: Date.now() - started };
}
```

Bốn chỗ đánh số là bốn ràng buộc của runtime: không retry, timeout 60s, không
retry (lần nữa — đánh dấu *sau khi* làm xong thì lần chạy sau không lặp lại), và
logs của run ERROR bị mất.

## Idempotent: ba cách, theo thứ tự nên dùng

1. **Cờ trạng thái trên chính record** — `"Đã gửi"`, `"Đã đồng bộ"`, `"Ngày xử
   lý"`. Filter loại việc đã làm, cập nhật ngay sau khi làm.
2. **Khoá tự nhiên + `unique`** — bản ghi kết quả có mã duy nhất (ví dụ
   `"DH-001-2026-08-14"`), tạo trùng thì server từ chối thay vì nhân đôi.
3. **Bảng log riêng** — mỗi lần chạy ghi một dòng `{ khoá, thời điểm }`, đầu run
   đọc lên để bỏ qua.

Cái không được dùng: đếm số lần chạy, hoặc tin rằng cron chỉ tick đúng một lần.
`automaticBackfill: true` còn cố tình chạy bù các kỳ bỏ lỡ.

## Chia lô để không chạm timeout

Một run là 60 giây. Việc dài thì cắt thành nhiều run, cron chạy dày hơn:

```ts
const BUDGET_MS = 45_000;                    // chừa chỗ cho phần dọn dẹp

async function main() {
  const started = Date.now();
  const items = await erp.object("Hàng đợi");
  const rows = await items.records()
    .where("Trạng thái", "equals", "pending")
    .orderBy("Ngày tạo", "asc")            // field thật của bảng — createdAt KHÔNG sort được
    .fetchAll({ max: 500 });

  let processed = 0;
  for (const row of rows) {
    if (Date.now() - started > BUDGET_MS) break;   // hết giờ thì để run sau làm nốt
    await xuLy(row);
    processed++;
  }
  return { processed, remaining: rows.length - processed };
}
```

Đừng `await new Promise(r => setTimeout(r, 60_000))` để chờ gì cả — chờ lâu là
việc của cron, không phải của code.

## Tiền: `decimal.js`

```ts
import Decimal from "decimal";

async function main() {
  const df = (await erp.sql(`
    SELECT "Khách hàng" AS kh, SUM("Tổng tiền") AS doanh_thu
    FROM "Đơn hàng" GROUP BY 1
  `)).toFrame();

  const rows = df.toArray().map((r) => ({
    kh: r.kh,
    doanhThu: new Decimal(r.doanh_thu).toFixed(0),   // numeric về JSON là CHUỖI
  }));

  const tong = rows.reduce((acc, r) => acc.plus(r.doanhThu), new Decimal(0));
  return { rows, tong: tong.toString() };            // trả chuỗi, không trả number
}
```

`new Decimal(0.1).plus(0.2).toString()` là `"0.3"`; `0.1 + 0.2` thì không. Ghi
ngược lại vào ERP cũng đưa chuỗi.

## Validate `input` bằng zod

Cron và người bấm tay gửi hai loại input khác nhau — code phải chịu được cả hai:

```ts
import { z } from "zod";

const Input = z.union([
  z.object({ source: z.literal("cron"), scheduledAt: z.string() }),
  z.object({ ngay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
]);

async function main(input) {
  const parsed = Input.safeParse(input ?? {});
  const ngay = parsed.success && "ngay" in parsed.data
    ? parsed.data.ngay
    : moment().format("YYYY-MM-DD");
  …
}
```

## Gửi ra ngoài

Secret luôn từ `process.env`, không bao giờ trong code. **Test-run không có
env** → phần này chỉ chạy được sau khi lưu và người dùng đã `setEnv`.

```ts
import nodemailer from "email";
import TelegramBot from "telegram";
import { WebClient } from "slack";

async function main() {
  const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD, BOT_TOKEN, CHAT_ID } = process.env;
  if (!SMTP_PASSWORD) return { skipped: "thiếu env SMTP_PASSWORD" };  // báo, đừng đoán

  const mailer = nodemailer.createTransport({
    host: SMTP_HOST, port: 465, secure: true,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
  });
  await mailer.sendMail({ to: "ketoan@cty.vn", subject: "Hoá đơn quá hạn", text: "…" });

  await new TelegramBot(BOT_TOKEN).sendMessage(CHAT_ID, "…");
  await new WebClient(process.env.SLACK_TOKEN).chat.postMessage({ channel: "#erp", text: "…" });
}
```

⚠️ **Test-run gửi thật.** Mail, tin nhắn bot, webhook không được rehearse. Thử
thì gửi cho **một** địa chỉ của chính người dùng trước, đừng bắn cả danh sách.

## Gọi LLM

```ts
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

async function main() {
  const { object } = await generateObject({
    model: openai("gpt-4o-mini"),          // key lấy từ process.env.OPENAI_API_KEY
    schema: z.object({ tomTat: z.string(), rui_ro: z.array(z.string()) }),
    prompt: "…",
  });
  return object;
}
```

Nhớ trần 60s: một prompt dài trên model chậm có thể ăn hết cả run.

## HTTP ra ngoài

`axios` là global, `fetch` cũng có. Mạng ra ngoài được phép; đĩa và process thì
không. Đặt timeout cho request ngoài, nếu không nó ăn hết ngân sách của run:

```ts
const { data } = await axios.get("https://api.doi-tac.vn/orders", {
  timeout: 10_000,
  headers: { Authorization: `Bearer ${process.env.PARTNER_TOKEN}` },
});
```

## Trả về cái gì

`main()` trả **số liệu tổng hợp và danh sách lỗi**, không trả cả bảng — 256KB
là trần, và người đọc run cần biết "đã làm gì", không cần dump dữ liệu.

```ts
return {
  quet: rows.length,
  capNhat: done.length,
  boQua: skipped.length,
  loi: failed.slice(0, 20),          // đủ để sửa, không tràn
  ngay: moment().format("YYYY-MM-DD HH:mm"),
};
```

## Những thứ **không** viết được trong workflow

| Muốn làm | Vì sao không | Làm thay bằng |
| --- | --- | --- |
| Đọc/ghi file, đọc CSV/Excel từ đĩa | Không có `node:fs`, `xlsx`, `csv-parse` | Nhận dữ liệu qua `input`, hoặc tải qua HTTP rồi parse bằng code thuần |
| `npm install` thêm thư viện | Registry cố định | Viết tay, hoặc gọi API bên thứ ba bằng axios |
| Webhook / trigger khi record đổi | Chỉ có `manual` + `cron` | Cron quét theo trạng thái, hoặc mini app gọi `wf.run()` |
| Chờ 5 phút rồi làm tiếp | Timeout 60s | Hai workflow, hoặc một cron dày + cờ trạng thái |
| Chạy với quyền cao hơn người dùng | Không có service account trong run | Xin quyền cho actor, hoặc đổi người publish cron |
| Xoá record trong lúc test-run | `delete`/`restore`/link call không có dry run | Chứng minh phần còn lại, mô tả phần xoá cho người dùng duyệt |
