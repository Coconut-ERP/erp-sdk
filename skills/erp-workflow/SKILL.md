---
name: erp-workflow
description: Viết và sửa code chạy bên trong workflow ERP 1kk — một file TypeScript có `async function main(input)` mà server ERP giữ và tự chạy theo cron hoặc khi có người bấm. Dùng khi task nhắc tới viết/sửa code workflow, `async function main`, sandbox/runtime của workflow, module nào import được (`node:fs` bị chặn), cron 6 trường có giây, draft/publish/version, `POST /workflows/check` hay `/workflows/test-run`, env write-only của workflow, run bị ERROR/timeout/không retry, hoặc khi người dùng muốn "chạy script định kỳ trên ERP", "gửi mail nhắc hạn mỗi sáng", "đồng bộ hằng đêm", "tự động hoá trên ERP". Quản lý workflow bằng SDK (create/publish/run/setEnv) nằm ở skill erp-data; dựng web app thì dùng erp-miniapp.
---

# Viết code workflow ERP

Workflow **không phải** script chạy ở máy bạn. Nó là một file TypeScript mà ERP
lưu và chạy trên runner của nó, sau này, trong một sandbox rất hẹp. Chạy file đó
bằng `node` ở local không chứng minh được gì — nó còn không khởi động nổi, vì
`erp`, `_`, `moment`, `axios`, `input` là **global do runner bơm vào**, không có
ở đâu khác.

**Không có step, không có node, không có expression language.** Cả workflow là
một hàm:

```ts
async function main(input) {
  // ...
  return { checked: 12, updated: 3 };   // → output.result của run
}
```

Chỉ có **`manual`** và **`cron`**. Không webhook, không trigger theo sự kiện
record — muốn phản ứng theo dữ liệu thì cron quét, hoặc để mini app tự gọi.

## 1. Vòng lặp bắt buộc: check → test-run → lưu → publish

**Đừng bao giờ tạo workflow chỉ để xem code có chạy không.** Có hai endpoint
không lưu gì cả, và chúng là nơi bạn sửa lỗi:

```ts
// erp.http là public — check/test-run chưa có method riêng trong SDK
await erp.http.request("POST", "/workflows/check", { body: { code } });
// → { valid: true }, hoặc ném ErpApiError nêu đúng dòng/cột hoặc module bị cấm

const t = await erp.http.request("POST", "/workflows/test-run", {
  body: { code, input: {} },
});
// → { ok, dryRun: true, result, logs, durationMs, error }
```

- `check` chỉ transpile: rẻ, chạy sau **mỗi lần sửa**.
- `test-run` **chạy thật trong runner thật**, với `ERP_ENV=development` nên
  create/update/bulk update được server validate đầy đủ rồi **rollback**. Đây là
  cách tìm ra tên field sai trước khi phiền người dùng.
- `ok: false` là **script lỗi**, không phải request lỗi — đọc `error.message`,
  `error.line`, `logs`, sửa, chạy lại.
- **503 = runner đang bận**, không phải code sai: chờ vài giây, gửi lại **đúng
  code đó**, đừng viết lại.
- Test-run **không được cấp env** (code chưa lưu thì chưa thuộc workflow nào) →
  script phụ thuộc secret chỉ chứng minh được sau khi đã lưu và người dùng đã
  set giá trị.

Những gì test-run **không** rehearse mà làm thật: tạo bảng/field, mọi thứ gửi ra
ngoài (mail, bot, webhook). `delete`, `restore`, link call thì **từ chối chạy**
chứ không giả vờ. Chi tiết: `references/testing.md`.

Chỉ khi đã `ok: true` mới `erp.workflows.create(...)` rồi `publish()`. Cần hỏi
người dùng trước khi tạo/sửa/xoá workflow — đó là thứ sẽ tự chạy trên dữ liệu
thật.

## 2. Trong sandbox có gì

Global, **không import**: `erp` (ErpClient đã trỏ đúng workspace, đúng danh tính
người chạy), `_` (lodash), `moment`, `axios`, `input`, `env`, `console`,
`process` (bản giả, chỉ có `env`, `argv`, `platform`, `version`). `fetch` là
global của Node nên cũng dùng được.

Import được, và **chỉ** những cái này:

| Module | Alias | Dùng để |
| --- | --- | --- |
| `axios` | — | HTTP |
| `zod` | — | validate input |
| `decimal.js` | `decimal` | **số tiền** |
| `nodemailer` | `email` | SMTP |
| `node-telegram-bot-api` | `telegram` | bot Telegram |
| `@slack/web-api` | `slack` | Slack |
| `yahoo-finance2` | `yfinance`, `yahoo-finance` | giá/tỉ giá |
| `ai` + `@ai-sdk/openai` \| `@ai-sdk/anthropic` \| `@ai-sdk/google` | — | LLM (ES-only: **import theo tên**) |
| `lodash`, `moment`, `erp-sdk` | — | bản đầy đủ của global |

Ngoài danh sách → **400 ngay lúc lưu**, kể cả `node:fs`, `node:child_process`,
`node:net`, `xlsx`, `csv-parse`. Không đĩa, không process con. Mạng ra ngoài thì
**mở** — gọi API bên thứ ba là đúng thiết kế.

## 3. Giới hạn cứng

| Hạng mục | Trần |
| --- | --- |
| Code | 128KB |
| `input` | 64KB JSON |
| `main()` trả về | 256KB, **phải JSON-serializable** |
| `console.*` | 64KB, quá thì cắt (`… output truncated`) |
| 1 run | mặc định **60s** (admin nới được tới 15 phút) |
| Run song song | 4/runner, quá thì xếp hàng rồi 429 |
| Tên workflow | ≤255, **unique trong workspace** |

## 4. Sáu ràng buộc quyết định cách viết code

**1. Run không bao giờ chạy lại.** Fail hay bị worker restart giữa chừng
(`workflow run was interrupted and is not retried`) đều không có lần hai, và
những gì đã ghi **vẫn còn**. → Viết **idempotent**: chọn việc theo trạng thái
(`.where("Đã gửi", "equals", false)`), đánh dấu ngay sau khi làm, đừng dựa vào
"chạy đủ một lần".

**2. 60 giây là 60 giây.** Không `sleep` để chờ, không quét 50 000 record trong
một run. → Mỗi run xử lý một lô có trần (`fetchAll({ max })`, `limit`), cron
chạy dày hơn để tiêu hết hàng đợi.

**3. Code chạy bằng quyền của người bấm chạy** (với cron: người publish). Không
có service account, không có "chạy quyền cao hơn". Lỗi quyền là **ranh giới
thật** — báo lại, đừng lách.

**4. Secret chỉ nằm trong env của workflow**, đọc bằng `process.env.TÊN` /
`env.TÊN`. Không hardcode: code lưu nguyên văn trong DB và trong lịch sử run.
Chỉ **người dùng** set giá trị — bạn để tên biến, báo tên đó cho họ.

**5. Run ERROR không lưu logs.** Phần log duy nhất là mấy dòng cuối bị nhét vào
`error`. → Cái gì cần xem lại thì **trả về trong `main()`**, và bọc phần rủi ro
bằng `try/catch` để trả `{ ok: false, failed: [...] }` thay vì throw trần.

**6. Tiền là `decimal.js`.** ERP lưu decimal chính xác, `number` của JS là
float64 — `+`/`*` trên tiền mất tiền âm thầm. Cột `numeric` từ SQL về JSON là
**chuỗi**, giữ nguyên chuỗi khi đưa vào `Decimal`, trả kết quả ra cũng bằng
`.toString()`.

## 5. Bẫy đã trả giá

| Triệu chứng | Nguyên nhân |
| --- | --- |
| Sửa code xong chạy vẫn ra kết quả cũ | Quên `publish()` — **mọi update đưa workflow về draft** và gỡ cron; run luôn dùng bản active |
| `Invalid cron schedule` với `"0 9 * * *"` | Cron là **6 trường, có giây**: `"0 0 9 * * *"`. Cần cả `timezone` IANA |
| 409 `Workflow version conflict` | Version là khoá lạc quan, mọi mutation (kể cả publish) đều +1 → `await wf.refresh()` rồi thử lại |
| Import khai báo mà không báo lỗi, cũng không chạy | Compiler loại bỏ import không dùng **trước** khi kiểm registry |
| `Module "..." is not available` | Ngoài registry §2 — không có cách cài thêm |
| Run ngay sau `publish()` trả `ERROR` chung chung `"Workflow run failed"` | Runner chưa thấy version mới, không phải code sai — đợi vài giây |
| Secret biến mất sau khi thêm khoá mới | `setEnv` **thay cả map**; gửi kèm `WORKFLOW_ENV_KEEP` (`"[KEEP]"`) cho tên cũ |
| Tick cron trả `{ skipped: true, reason }` | Schedule cũ (workflow đã sửa/unpublish/xoá) — nó tự gỡ sau tick đó |
| `Workflow result is too large` | `main()` trả > 256KB — trả số liệu tổng hợp, đừng trả cả bảng |
| Đọc ra 0 dòng trong khi UI có dữ liệu | Row scope IAM của **actor**, không phải filter sai |

## 6. Trước khi bàn giao

- [ ] `check` sạch, `test-run` `ok: true` với input thật.
- [ ] Chạy hai lần liên tiếp không nhân đôi tác dụng (idempotent).
- [ ] Có trần cho mọi vòng lặp/`fetchAll`, ước lượng nằm dưới 60s.
- [ ] Không có secret trong code; các tên env cần set đã liệt kê cho người dùng.
- [ ] `main()` trả về đủ để hiểu run đã làm gì, và đủ nhỏ.
- [ ] Tên object/field lấy từ schema thật (`npx erp objects show`), không đoán.
- [ ] Cron: đúng 6 trường + timezone, và người dùng biết nó chạy lúc mấy giờ.

Báo lại cho người dùng: tên/id/version/trigger của workflow, run trả gì hoặc lỗi
gì, tên env còn thiếu, và việc gì chưa làm.

## Tham chiếu

- `references/runtime.md` — hợp đồng runtime đầy đủ: global, registry module,
  quy tắc import, `process` bị bịt tới đâu, log/result, thông điệp lỗi.
- `references/authoring.md` — mẫu code chạy được: idempotent, chia lô theo
  timeout, tiền bằng `decimal.js`, gửi mail/Telegram/Slack, gọi LLM, validate
  `input` bằng zod.
- `references/testing.md` — `check`/`test-run` chi tiết, cái gì rehearse cái gì
  thật, vòng đời draft/publish/version, đọc kết quả run.
- Quản lý workflow bằng SDK (`erp.workflows`, `setEnv`, `runAndWait`, sharing) →
  skill **`erp-data`**, `references/workflows.md`.
- Truy vấn/ghi dữ liệu bên trong `main()` (RecordQuery, relation, DataFrame,
  SQL) → skill **`erp-data`**.
