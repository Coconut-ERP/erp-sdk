# 12 — Workflow

[← Truy vấn SQL & dashboard](11-truy-van-sql-dashboard.md) · [Mục lục](README.md)

Workflow là **một file TypeScript chạy trên server ERP**: gửi email nhắc đơn quá
hạn mỗi sáng, đồng bộ sang hệ thống khác, tổng hợp số liệu cuối ngày. Nó tồn tại
để những việc đó không cần một service riêng — không deploy, không cron host,
không nơi cất secret.

Khác với mini app (một web app đầy đủ, có UI, xem [01](01-tong-quan.md)),
workflow là một script không giao diện, chạy theo lượt.

## 1. Mô hình

```
tạo (draft, version 1) ──► publish ──► version active
        ▲                                   │
        │ mỗi lần update → quay lại draft    ├─ chạy tay: POST /runs
        └────────────────────────────────────┤
                                             └─ cron: server tự chạy
```

- **Code** là một file, có `async function main(input)`. `input` là payload lúc
  chạy, giá trị `main` trả về được lưu trong kết quả run.
- **Version** là khoá lạc quan: mọi thay đổi (kể cả `publish`) đều tăng nó, và
  `update`/`publish`/`delete` phải gửi version hiện tại → sai thì 409.
- **Draft không chạy.** Sửa code xong mà quên `publish` thì run vẫn dùng bản cũ.
- **Run chạy dưới quyền của người gọi**, không phải quyền của người viết.

## 2. Trong script chạy có sẵn gì

Runner nạp sẵn, **không cần import**: `erp` (client SDK đã đăng nhập sẵn),
`_` (lodash), `moment`, `axios`, `input`.

Import theo tên được: `zod`, `nodemailer`, `node-telegram-bot-api`,
`@slack/web-api`, `yahoo-finance2`, `ai` và các provider `@ai-sdk/*`. Ngoài danh
sách đó — kể cả `node:fs`, `node:child_process` — thì không.

```ts
async function main(input) {
  const orders = await erp.object("Đơn hàng");
  const quaHan = await orders.records()
    .where("Trạng thái", "equals", "new")
    .where("Hạn giao", "less_than", moment().format("YYYY-MM-DD"))
    .fetchAll({ max: 500 });

  console.log(`Có ${quaHan.length} đơn quá hạn`);
  return { count: quaHan.length };
}
```

`console.log` được thu lại và trả về cùng kết quả run.

## 3. Tạo, sửa, publish từ SDK

```ts
const wf = await erp.workflows.create({
  name: "Nhắc đơn quá hạn",
  description: "Chạy 9h sáng mỗi ngày",
  code,                                   // chuỗi, phải có async function main
  trigger: { type: "cron", config: { schedule: "0 0 9 * * *", timezone: "Asia/Ho_Chi_Minh" } },
  env: { SMTP_PASSWORD: "…" },
});

await wf.publish();          // draft → active, dùng version hiện tại
wf.isPublished;              // true
```

Sửa rồi publish lại:

```ts
await wf.update({ code: codeMoi });   // version tự lấy từ handle, workflow về draft
await wf.publish();
```

Lấy lại về sau — theo **tên** hoặc id, giống `erp.object()`:

```ts
const wf = await erp.workflow("Nhắc đơn quá hạn");
wf.version; wf.status; wf.trigger; wf.code; wf.envNames;
await wf.refresh();
await erp.workflows.list({ limit: 50 });   // danh sách, không kèm code
await wf.delete();
```

### Trigger

Chỉ có **hai** loại (`WORKFLOW_TRIGGER_TYPES`) — không có webhook, không có
trigger theo sự kiện record:

| Trigger | Config |
| --- | --- |
| `{ type: "manual" }` | không cần gì; chỉ chạy khi có người gọi |
| `{ type: "cron", config: { schedule, timezone } }` | `schedule` **6 trường (có giây)** hoặc descriptor; `timezone` là tên IANA |

```
"0 0 9 * * *"      → 9:00 mỗi ngày        (giây phút giờ ngày tháng thứ)
"0 */15 * * * *"   → mỗi 15 phút
"@daily", "@every 1h"
"0 9 * * *"        → ✗ 5 trường, server từ chối
```

Sai trigger hoặc code thiếu `main()` → `WorkflowDefinitionError` ném ngay ở
client, chưa gửi request.

## 4. Env: nơi duy nhất cất secret

Script không có biến môi trường của máy chủ; mọi khoá (SMTP, bot token, API key
model) đi qua env của chính workflow, đọc trong script bằng `env.X` /
`process.env.X`.

```ts
await wf.setEnv({ SMTP_PASSWORD: "…", BOT_TOKEN: "…" });
wf.envNames;      // ["SMTP_PASSWORD", "BOT_TOKEN"] — giá trị luôn là "***"
```

Ba điều dễ mất dữ liệu nếu không nhớ:

1. **Thay nguyên map.** Tên nào không gửi là bị xoá.
2. **Giá trị không đọc lại được, bao giờ cũng vậy** — mã hoá lúc lưu, chỉ giải
   mã khi run bắt đầu. Muốn giữ một giá trị đang có thì gửi kèm sentinel
   `WORKFLOW_ENV_KEEP` (`"[KEEP]"`):
   ```ts
   await wf.setEnv({ SMTP_PASSWORD: WORKFLOW_ENV_KEEP, BOT_TOKEN: "token-mới" });
   ```
   Giữ một tên chưa từng có giá trị → 400.
3. Đổi env **không** tăng version, không đưa workflow về draft, không huỷ lịch
   cron; run kế tiếp tự lấy giá trị mới. Tối đa 50 entry, tên theo
   `[A-Za-z_][A-Za-z0-9_]*`.

## 5. Chạy và chờ kết quả

Run là **hàng đợi**: `run()` trả về ngay với `status: "ENQUEUED"`.

```ts
const started = await wf.run({ ngay: "2026-08-14" });   // input → main(input)
const done    = await wf.waitForRun(started.id, { timeoutMs: 60_000 });

// gộp hai bước
const done2 = await wf.runAndWait({ ngay: "2026-08-14" });

runResult(done);   // giá trị main() trả về
runLogs(done);     // các dòng console.log
```

Vòng đời: `ENQUEUED` → `PENDING` (đang chạy) → `SUCCESS` | `ERROR`.
`isRunFinished(status)` trả lời "xong chưa".

- `ERROR` → `waitForRun` ném `WorkflowRunFailedError`, `run.error` là đúng
  message script đã throw (kèm log). Muốn tự xử lý thì
  `{ throwOnError: false }`.
- Hết giờ chờ → `WorkflowRunTimeoutError`. **Run không bị huỷ** — nó vẫn chạy
  tiếp, quay lại đọc bằng `getRun(runId)`.

```ts
await wf.runs({ limit: 20 });          // lịch sử run, mới nhất trước
await wf.getRun(runId);
```

`run.output` là **chuỗi JSON** `{ workflowId, version, result, logs,
durationMs }` — `runOutput(run)` parse hộ, `runResult` / `runLogs` là lối tắt.

### Chế độ development chặn `run()`

Chạy một workflow là ghi dữ liệu thật, và server **không có dry run** cho nó.
Nên khi client đang ở `ERP_ENV=development`, `run()`/`runAndWait()` ném
`DryRunUnsupportedError` thay vì âm thầm chạy thật — giống `delete` (xem
[03 — Dữ liệu](03-du-lieu.md)).

```ts
await wf.run(input, { dryRun: false });   // vẫn muốn chạy thật
```

Ngược lại, mọi thao tác *định nghĩa* (create/update/publish/setEnv/delete) là
thay đổi cấu trúc — luôn chạy thật, kể cả ở development, đúng như
`createObject`. Muốn thử code an toàn thì cho **chính script** ghi ở chế độ dry
run, hoặc publish sang một workflow riêng để thử.

## 6. Chia sẻ và quyền

```ts
await wf.sharing();                       // { visibility, entries }
await wf.setSharing("restricted", [
  { subjectType: "user", subjectId: userId, access: "write" },
]);
```

Quyền IAM đi theo hai resource `workflow` (định nghĩa) và `workflow:run` (lượt
chạy), với action `create`/`read`/`update`/`delete` như mọi resource khác:
`workflow:read` để xem, `workflow:run:create` để khởi chạy. Xem key hiện tại có
gì bằng `npx erp whoami`, hoặc kiểm thẳng:

```bash
npx erp doctor --require workflow:read --require workflow:run:create
```

Bản thân script còn bị chặn bởi quyền của người gọi: một workflow ghi vào bảng
mà người bấm chạy không có `object:record:create` sẽ fail ngay trong run.

## 7. Bẫy hay gặp

| Triệu chứng | Nguyên nhân |
| --- | --- |
| Sửa code xong chạy vẫn ra kết quả cũ | Quên `publish()` — run luôn dùng bản active |
| 409 `Workflow version conflict` | Có người (hoặc chính bạn) vừa sửa; `await wf.refresh()` rồi thử lại |
| `Invalid cron schedule` với `"0 9 * * *"` | Thiếu trường giây — phải 6 trường |
| Secret biến mất sau khi thêm khoá mới | `setEnv` thay cả map; gửi kèm `"[KEEP]"` cho các tên cũ |
| Run `ERROR` mà `output` rỗng | Script throw — đọc `run.error`, không phải `runResult` |
| Run **ngay sau `publish()`** trả `ERROR` với message chung `"Workflow run failed"` | Lỗi phía runner (chưa thấy version vừa publish), không phải code sai — đợi vài giây rồi chạy lại; message do script throw ra bao giờ cũng cụ thể hơn thế |
| `run()` ném `DryRunUnsupportedError` | Đang `ERP_ENV=development` (§5) |

---

[← Truy vấn SQL & dashboard](11-truy-van-sql-dashboard.md) · [Mục lục](README.md)
