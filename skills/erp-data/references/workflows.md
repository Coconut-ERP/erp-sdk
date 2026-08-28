# Workflows — Scripts Running on ERP Server

A workflow is **a TypeScript file exporting `async function main(input)`**. ERP
stores the code, secrets, and schedule; no need to build a separate service for
scheduled work (reminders each morning, nightly syncs, end-of-month summaries).

## Environment inside scripts

Available without import: `erp` (authenticated client), `_` (lodash),
`moment`, `axios`, `input`.

Importable by name: `zod`, `decimal.js` (alias `decimal`), `nodemailer`
(`email`), `node-telegram-bot-api` (`telegram`), `@slack/web-api` (`slack`),
`yahoo-finance2` (`yfinance`), `ai`, `@ai-sdk/*`, plus full versions of globals
(`lodash`, `moment`, `axios`, `erp-sdk`).

Anything not in that list — **including `node:fs`** — is off-limits.

Secrets are read from `process.env.NAME` (set via `setEnv`).

Writing/editing the code itself (runtime, limits, `workflows.check`/`workflows.testRun`) →
**`erp-workflow`** skill.

## Lifecycle

```
create ──► draft ──► publish() ──► active ──► run (manual / cron / webhook)
             ▲                        │
             └──── update() any ─────┘        ⚠ must republish
```

```ts
const wf = await erp.workflows.create({
  name: "Overdue reminders",
  code,                      // string, must have async function main
  trigger: {
    type: "cron",
    config: { schedule: "0 0 9 * * *", timezone: "Asia/Ho_Chi_Minh" },
  },
  env: { SMTP_PASSWORD: "…" },
  description: "Send emails at 9am",
});
await wf.publish();          // without publish, cron runs old version / nothing runs
```

Editing code later:

```ts
const wf = await erp.workflow("Overdue reminders");   // resolve by name
await wf.update({ code: newCode });                   // → reverts to draft
await wf.publish();
```

## Trigger

Có **`manual`**, **`cron`** và **`webhook`** (`WORKFLOW_TRIGGER_TYPES`). Không
có trigger theo sự kiện record.

Cron là **6 trường, có giây**, cộng timezone IANA:

```ts
{ type: "cron", config: { schedule: "0 0 9 * * *", timezone: "Asia/Ho_Chi_Minh" } }
```

`"0 0 9 * * *"` = 9h00 mỗi ngày. `"0 9 * * *"` (5 trường kiểu crontab) **bị từ
chối**. Descriptor `@daily`, `@every 1h` cũng được.

`manual` và `webhook` **không nhận config**, gửi thừa key là 400.

### Webhook

```ts
const wf = await erp.workflows.create({ name: "Nhận thanh toán", code, trigger: { type: "webhook" } });
await wf.publish();                  // draft trả 404, publish rồi URL mới sống
wf.webhookUrl;                       // "https://…/api/v1/webhooks/<token>" — chỉ đọc
```

Thử script bằng `POST <webhookUrl>/test`: cùng URL thêm `/test`, chạy được cả
khi còn draft, ghi record được rollback, trả `202` kèm run id y như bản thật.
Log và kết quả đọc bằng `wf.waitForRun(runId)` / `wf.getRun(runId)` — request
`/test` không trả chúng, vì ai cầm URL cũng gọi được.

`webhookUrl` **là credential**: ai cầm nó cũng chạy được workflow, server không
kiểm chữ ký. Đừng log, đừng in vào report gửi cho agent khác — đưa người dùng
vào trang workflow để tự copy. Đổi trigger sang `manual`/`cron` là URL bị thu
hồi luôn.

Payload tới `main(input)` là `{ source: "webhook", method, query, headers, body,
receivedAt }` với `body` là **chuỗi thô**; verify chữ ký là việc của code trong
workflow (skill `erp-workflow`).

The SDK validates before making calls with `assertWorkflowTrigger` / `assertWorkflowCode` /
`assertWorkflowEnv` → `WorkflowDefinitionError` with `.field` and `.reason`.

## Env — write-only, replaces entire map

```ts
await wf.setEnv({ SMTP_PASSWORD: WORKFLOW_ENV_KEEP, BOT_TOKEN: "new-token" });
```

`PUT /env` **replaces the whole map**: names you don't send are **gone**. Stored values
are never readable again (`wf.envNames` returns names only) — so to add a key while keeping
old ones, send them with the sentinel `WORKFLOW_ENV_KEEP` (`"[KEEP]"`). Max 50 entries
(`MAX_WORKFLOW_ENV_ENTRIES`); names must match `[A-Za-z_][A-Za-z0-9_]*`.

`setEnv` **doesn't** bump version, doesn't revert to draft, doesn't retire cron — the
next run picks up the new values.

## Shared variables — state across workflows

Env is **one** workflow's secrets; shared variables are state, strings, readable again,
and granted to **multiple** workflows:

```ts
await erp.variables.create({
  key: "invoice.cursor",
  value: "2026-08-01",
  description: "Invoice sync cursor",
  workflowIds: [wf.id, other.id],        // who gets read/write — no read-only grant
});

await erp.variables.update("invoice.cursor", { workflowIds: [wf.id] });  // replaces the list
await erp.variables.list();
await erp.variables.delete("invoice.cursor");                            // frees key for reuse
```

- Empty `workflowIds` = **no run** can access; all ids must be workflows in the same
  workspace (unknown id → 400 immediately).
- Inside a run, that list **restricts** the actor's permissions: scripts only see variables
  of the workflow they're running in, and can only `set` values. Creating, deleting, or
  changing scope is a user session action — the right place for it.
- Last write wins, no versioning. Limits: key ≤ 128 (`[A-Za-z][A-Za-z0-9_.-]*`), value
  ≤ 16 384 chars, ≤ 100 workflows per variable.
- `variables.set/create/update/delete` throws in `ERP_ENV=development`
  (`DryRunUnsupportedError`); reads are fine.

## Running and reading results

```ts
const run = await wf.runAndWait({ date: "2026-08-14" });   // run + wait
runResult(run);      // value main() returned
runLogs(run);        // console.log lines
```

Split into two steps if needed: `wf.run(input)` returns immediately (`ENQUEUED`), then
`wf.waitForRun(runId, { timeoutMs, intervalMs, throwOnError })`.

States: `ENQUEUED` → `PENDING` → `SUCCESS` | `ERROR`
(`isRunFinished(status)`, `WORKFLOW_RUN_PENDING_STATUSES`).

- `ERROR` → `waitForRun` throws `WorkflowRunFailedError`; `.run.error` is exactly what the
  script threw, with its log.
- Timeout → `WorkflowRunTimeoutError`. **Run is not cancelled** — query it again with
  `wf.getRun(runId)`.
- `run.output` is a **JSON string** (`{ workflowId, version, result, logs, durationMs }`)
  — use `runOutput`/`runResult`/`runLogs`, don't parse it yourself.

History: `wf.runs({ limit: 20, offset: 0 })`.

⚠️ **Run immediately after `publish()`** sometimes returns `ERROR` with a generic message
`"Workflow run failed"` — that's the runner not seeing the new version yet, not a script error
(script errors are always specific). Wait a few seconds then retry.

## Dry run: doesn't exist

`wf.run()` is blocked when the client is in `ERP_ENV=development` — throws
`DryRunUnsupportedError`. Running a workflow **writes for real**, no dry run on the server.
To run anyway: `wf.run(input, { dryRun: false })`.

By contrast, **defining** workflows (create/update/publish/setEnv) is structural and
always writes for real in both modes.

## API surface

| Export | Note |
| --- | --- |
| `erp.workflows.list({ limit?, offset? })` · `listAll()` | Excludes `code` |
| `erp.workflows.create({ name, code, trigger, description?, env? })` | Returns handle in **draft** |
| `erp.workflow(nameOrId)` | Resolves id → exact name → case-insensitive name; loads `code` |
| `wf.id` · `name` · `version` · `status` · `isPublished` · `trigger` · `code` · `envNames` · `meta` | Properties |
| `wf.webhookUrl` | Only with `webhook` trigger; is a credential; **read-only — the SDK does not rotate it** |
| `wf.update({ name?, description?, trigger?, code?, version? })` | Reverts to **draft** |
| `wf.publish(version?)` · `wf.refresh()` · `wf.delete(version?)` | `version` defaults to the handle's |
| `wf.setEnv(env)` | Replaces entire map |
| `wf.run(input?, { dryRun? })` · `wf.runAndWait(input?, options?)` | |
| `wf.waitForRun(runId, { timeoutMs?, intervalMs?, throwOnError? })` | Defaults: 120 000ms / 1 000ms / throw |
| `wf.runs({ limit?, offset? })` · `wf.getRun(runId)` | |
| `wf.sharing()` · `wf.setSharing(visibility, entries?)` | `"workspace"` \| `"restricted"` |
| `erp.variables.list()` · `get(key)` · `value(key)` | `value` returns `undefined` if unreadable |
| `erp.variables.create({ key, value?, description?, workflowIds? })` · `update(key, changes)` · `set(key, value)` · `delete(key)` | |
| `runOutput(run)` · `runResult(run)` · `runLogs(run)` | |
| `isRunFinished(status)` · `WORKFLOW_RUN_PENDING_STATUSES` · `WORKFLOW_TRIGGER_TYPES` · `WORKFLOW_ENV_KEEP` · `MAX_WORKFLOW_ENV_ENTRIES` | |

`version` is optimistic locking — every mutation bumps it, mismatch → 409:
`await wf.refresh()` then retry.

## Complete example

```js
const code = `
async function main(input) {
  const orders = await erp.object("Orders");
  const overdue = await orders.records()
    .where("Status", "equals", "new")
    .where("DeliveryDate", "less_than", moment().format("YYYY-MM-DD"))
    .fetchAll({ max: 500 });

  console.log("Overdue:", overdue.length);
  return { count: overdue.length };
}`;

const wf = await erp.workflows.create({
  name: "Overdue reminders",
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

Required permissions: `workflow` (read/create/update) and `workflow:run` (execute) — run `npx erp whoami`
to see what your key has.
