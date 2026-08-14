# Workflow — script chạy trên server ERP

Một workflow là **một file TypeScript export `async function main(input)`**. ERP
giữ code, secret và lịch chạy; không cần dựng service riêng cho việc chạy định
kỳ (nhắc hạn mỗi sáng, đồng bộ hằng đêm, tổng hợp cuối tháng).

## Môi trường trong script

Có sẵn, **không cần import**: `erp` (client đã xác thực), `_` (lodash),
`moment`, `axios`, `input`.

Import theo tên được: `zod`, `decimal.js` (alias `decimal`), `nodemailer`
(`email`), `node-telegram-bot-api` (`telegram`), `@slack/web-api` (`slack`),
`yahoo-finance2` (`yfinance`), `ai`, `@ai-sdk/*`, cộng bản đầy đủ của các global
(`lodash`, `moment`, `axios`, `erp-sdk`).

Ngoài danh sách đó — **kể cả `node:fs`** — thì không.

Secret đọc bằng `process.env.TÊN` (đã set qua `setEnv`).

Viết/sửa chính đoạn code đó (runtime, giới hạn, `check`/`test-run`) → skill
**`erp-workflow`**.

## Vòng đời

```
create ──► draft ──► publish() ──► active ──► run (manual / cron)
             ▲                        │
             └──── update() bất kỳ ───┘        ⚠ phải publish lại
```

```ts
const wf = await erp.workflows.create({
  name: "Nhắc đơn quá hạn",
  code,                      // chuỗi, bắt buộc có async function main
  trigger: {
    type: "cron",
    config: { schedule: "0 0 9 * * *", timezone: "Asia/Ho_Chi_Minh" },
  },
  env: { SMTP_PASSWORD: "…" },
  description: "Gửi mail 9h sáng",
});
await wf.publish();          // không publish thì cron chạy bản cũ / không có gì
```

Sửa code về sau:

```ts
const wf = await erp.workflow("Nhắc đơn quá hạn");   // resolve theo tên
await wf.update({ code: codeMoi });                  // → về draft
await wf.publish();
```

## Trigger

Chỉ có **`manual`** và **`cron`** (`WORKFLOW_TRIGGER_TYPES`). Không có webhook,
không có trigger theo sự kiện record.

Cron là **6 trường, có giây**, cộng timezone IANA:

```ts
{ type: "cron", config: { schedule: "0 0 9 * * *", timezone: "Asia/Ho_Chi_Minh" } }
```

`"0 0 9 * * *"` = 9h00 mỗi ngày. `"0 9 * * *"` (5 trường kiểu crontab) **bị từ
chối**. Descriptor `@daily`, `@every 1h` cũng được.

SDK kiểm trước khi gọi mạng bằng `assertWorkflowTrigger` / `assertWorkflowCode` /
`assertWorkflowEnv` → `WorkflowDefinitionError` với `.field` và `.reason`.

## Env — write-only, thay cả map

```ts
await wf.setEnv({ SMTP_PASSWORD: WORKFLOW_ENV_KEEP, BOT_TOKEN: "token-mới" });
```

`PUT /env` **thay toàn bộ map**: tên nào không gửi là **mất**. Giá trị đã lưu
không bao giờ đọc lại được (`wf.envNames` chỉ trả tên) — nên muốn thêm một khoá
mà giữ các khoá cũ thì gửi kèm chúng với sentinel `WORKFLOW_ENV_KEEP`
(`"[KEEP]"`). Tối đa 50 entry (`MAX_WORKFLOW_ENV_ENTRIES`); tên phải khớp
`[A-Za-z_][A-Za-z0-9_]*`.

`setEnv` **không** bump version, không đưa về draft, không retire cron — run kế
tiếp tự lấy giá trị mới.

## Chạy và đọc kết quả

```ts
const run = await wf.runAndWait({ ngay: "2026-08-14" });   // run + chờ
runResult(run);      // giá trị main() trả về
runLogs(run);        // các dòng console.log
```

Tách hai bước khi cần: `wf.run(input)` trả ngay (`ENQUEUED`), rồi
`wf.waitForRun(runId, { timeoutMs, intervalMs, throwOnError })`.

Trạng thái: `ENQUEUED` → `PENDING` → `SUCCESS` | `ERROR`
(`isRunFinished(status)`, `WORKFLOW_RUN_PENDING_STATUSES`).

- `ERROR` → `waitForRun` ném `WorkflowRunFailedError`; `.run.error` chính là thứ
  script throw, kèm log của nó.
- Hết giờ → `WorkflowRunTimeoutError`. **Run không bị huỷ** — đọc tiếp bằng
  `wf.getRun(runId)`.
- `run.output` là một **chuỗi JSON** (`{ workflowId, version, result, logs,
  durationMs }`) — dùng `runOutput`/`runResult`/`runLogs`, đừng tự parse.

Lịch sử: `wf.runs({ limit: 20, offset: 0 })`.

⚠️ **Run ngay sau `publish()`** thỉnh thoảng trả `ERROR` với message chung
`"Workflow run failed"` — đó là runner chưa thấy version mới, không phải script
sai (lỗi do script throw luôn cụ thể hơn). Đợi vài giây rồi chạy lại.

## Dry run: không có

`wf.run()` bị chặn khi client ở `ERP_ENV=development` — ném
`DryRunUnsupportedError`. Chạy workflow là **ghi thật**, server không có dry run
cho nó. Cố ý chạy: `wf.run(input, { dryRun: false })`.

Ngược lại, **định nghĩa** workflow (create/update/publish/setEnv) là thao tác
cấu trúc, luôn ghi thật ở cả hai chế độ.

## Bề mặt API

| Export | Ghi chú |
| --- | --- |
| `erp.workflows.list({ limit?, offset? })` · `listAll()` | Không kèm `code` |
| `erp.workflows.create({ name, code, trigger, description?, env? })` | Trả handle ở **draft** |
| `erp.workflow(nameOrId)` | Resolve id → tên chính xác → tên không phân biệt hoa thường; đã nạp `code` |
| `wf.id` · `name` · `version` · `status` · `isPublished` · `trigger` · `code` · `envNames` · `meta` | Thuộc tính |
| `wf.update({ name?, description?, trigger?, code?, version? })` | Đưa về **draft** |
| `wf.publish(version?)` · `wf.refresh()` · `wf.delete(version?)` | `version` mặc định lấy của handle |
| `wf.setEnv(env)` | Thay cả map |
| `wf.run(input?, { dryRun? })` · `wf.runAndWait(input?, options?)` | |
| `wf.waitForRun(runId, { timeoutMs?, intervalMs?, throwOnError? })` | Mặc định 120 000ms / 1 000ms / throw |
| `wf.runs({ limit?, offset? })` · `wf.getRun(runId)` | |
| `wf.sharing()` · `wf.setSharing(visibility, entries?)` | `"workspace"` \| `"restricted"` |
| `runOutput(run)` · `runResult(run)` · `runLogs(run)` | |
| `isRunFinished(status)` · `WORKFLOW_RUN_PENDING_STATUSES` · `WORKFLOW_TRIGGER_TYPES` · `WORKFLOW_ENV_KEEP` · `MAX_WORKFLOW_ENV_ENTRIES` | |

`version` là khoá lạc quan — mọi mutation bump nó, lệch thì 409:
`await wf.refresh()` rồi thử lại.

## Ví dụ đầy đủ

```js
const code = `
async function main(input) {
  const orders = await erp.object("Đơn hàng");
  const quaHan = await orders.records()
    .where("Trạng thái", "equals", "new")
    .where("Hạn giao", "less_than", moment().format("YYYY-MM-DD"))
    .fetchAll({ max: 500 });

  console.log("Quá hạn:", quaHan.length);
  return { count: quaHan.length };
}`;

const wf = await erp.workflows.create({
  name: "Nhắc đơn quá hạn",
  code,
  trigger: {
    type: "cron",
    config: { schedule: "0 0 9 * * *", timezone: "Asia/Ho_Chi_Minh" },
  },
});
await wf.publish();

const run = await wf.runAndWait({});
console.log(runResult(run), runLogs(run));
```

Quyền cần: `workflow` (đọc/tạo/sửa) và `workflow:run` (chạy) — `npx erp whoami`
xem key có gì.
