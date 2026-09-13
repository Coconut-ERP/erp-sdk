# Workflows — Automation Running on ERP Server

ERP stores the schedule and what to run, so scheduled work (reminders each
morning, nightly syncs, end-of-month summaries) needs no separate service.

A workflow's **`kind`** says what one run does:

| `kind` | Content | A run |
| --- | --- | --- |
| `code` (default) | `code` — a TypeScript file exporting `async function main(input)` | the runner executes it |
| `agent` | `prompt` — up to 8 000 characters | opens a hidden copilot conversation and hands the prompt to it |

Triggers, draft/publish/version, webhook URL, sharing and run history are the
same for both. Sections below are about script workflows unless they say
otherwise; the agent-specific rules are in [Agent workflows](#agent-workflows).

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
`workflow-runtime.md` and `workflow-testing.md`.

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
workflow (`workflow-patterns.md`).

The SDK validates before making calls with `assertWorkflowTrigger` / `assertWorkflowCode` /
`assertWorkflowEnv` → `WorkflowDefinitionError` with `.field` and `.reason`.

## Agent workflows

```ts
const wf = await erp.workflows.create({
  name: "Tổng hợp đơn hôm qua",
  kind: "agent",
  prompt: "Tổng hợp đơn hàng hôm qua rồi ghi vào bảng Báo cáo ngày. …",
  trigger: { type: "cron", config: { schedule: "0 0 8 * * *", timezone: "Asia/Ho_Chi_Minh" } },
});
await wf.publish();

const run = await wf.runAndWait();
const handed = agentRunResult(run);
const chat = await erp.conversations.get(handed.conversationId);
chat.activeTurn;
chat.messages.at(-1)?.content;
```

`runAndWait` comes back in a second or two. `agentRunResult` is
`{ conversationId, turnId }`, or `undefined` on a script run. `activeTurn` is
set while the agent is still working; once it is gone, the last message is the
answer.

- **`SUCCESS` means handed over, not done.** The run ends when the turn is
  queued; the agent then works for minutes to an hour. Report it as *đã khởi
  tạo hội thoại*.
- **No env, no shared variables.** `setEnv` throws `WorkflowDefinitionError`
  before the server's 409; `erp.variables` answers only a script run's token.
- **No `check`, no `testRun`** — the handle refuses both. Running it is the
  only test, and it writes real data. `POST <webhookUrl>/test` runs the draft
  but the copilot is **not** in development mode, so it writes for real too.
- **Trigger input is appended to the prompt automatically**, under a heading
  telling the agent to treat it as data and never as instructions. Don't write
  placeholders into the prompt.
- **Permissions:** `workflow:run` create **and** `ai` create, checked at
  publish, at each manual run, at each cron tick and inside the run. Missing:
  403 `Workflow actor lacks ai:create`. A deployment without copilot: 503
  `Arion is not configured on this deployment`.
- **The conversation belongs to the actor** (the publisher, for cron and
  webhook) and is hidden — visible to them alone, not to admins and not to a
  mini app's service account. `erp.conversations.list({ visibility })` takes
  `visible` (default) | `hidden` | `all`.
- **Nothing prevents overlap.** A 5-minute cron over a 20-minute agent just
  opens parallel conversations.
- **Switching kind drops what the workflow held** — the code or the prompt, and
  the env as well when moving to `agent`. `update` insists on the replacement
  in the same call: `wf.update({ kind: "agent", prompt })`.

Writing the prompt itself → `agent-workflows.md`.

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
| `erp.workflows.create({ name, code, trigger, description?, env? })` | Script workflow; returns handle in **draft** |
| `erp.workflows.create({ name, kind: "agent", prompt, trigger, description? })` | Agent workflow; no `code`, no `env` |
| `erp.workflow(nameOrId)` | Resolves id → exact name → case-insensitive name; loads `code` |
| `wf.id` · `name` · `version` · `status` · `isPublished` · `trigger` · `code` · `envNames` · `meta` | Properties |
| `wf.kind` · `wf.isAgent` · `wf.prompt` | `"code"` \| `"agent"`; `prompt` is `""` on a script workflow |
| `wf.webhookUrl` | Only with `webhook` trigger; is a credential; **read-only — the SDK does not rotate it** |
| `wf.update({ name?, description?, trigger?, code?, prompt?, kind?, version? })` | Reverts to **draft**; changing `kind` needs the new content in the same call |
| `wf.publish(version?)` · `wf.refresh()` · `wf.delete(version?)` | `version` defaults to the handle's |
| `wf.setEnv(env)` | Replaces entire map |
| `wf.run(input?, { dryRun? })` · `wf.runAndWait(input?, options?)` | |
| `wf.waitForRun(runId, { timeoutMs?, intervalMs?, throwOnError? })` | Defaults: 120 000ms / 1 000ms / throw |
| `wf.runs({ limit?, offset? })` · `wf.getRun(runId)` | |
| `wf.sharing()` · `wf.setSharing(visibility, entries?)` | `"workspace"` \| `"restricted"` |
| `erp.variables.list()` · `get(key)` · `value(key)` | `value` returns `undefined` if unreadable |
| `erp.variables.create({ key, value?, description?, workflowIds? })` · `update(key, changes)` · `set(key, value)` · `delete(key)` | |
| `runOutput(run)` · `runResult(run)` · `runLogs(run)` | |
| `agentRunResult(run)` | `{ conversationId, turnId }` of an agent run, or `undefined` |
| `erp.conversations.list({ visibility?, page?, perPage? })` · `listAll()` · `get(id)` | Read-only; the caller's own conversations |
| `workflowPromptChars(prompt)` · `assertWorkflowPrompt(prompt)` · `MAX_WORKFLOW_PROMPT_CHARS` | The 8 000-character cap, counted by code point |
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
