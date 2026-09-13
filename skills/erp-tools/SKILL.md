---
name: erp-tools
description: Use the Coconut ERP's tools beyond records through erp-sdk — workflows (script or agent, triggers manual/cron/webhook, draft/publish/version, env, runs, `workflows.check`/`testRun`, the runner sandbox and its modules), the drive (folders, upload, download, sharing, trash), shared variables (`erp.variables`), copilot conversations (`erp.conversations`), the personal AI task board a member shares with Arion (`erp.tasks` — tasks, comments, tags, status columns), and who the caller is and what it may do (`whoami`, `can`, `asUser`, sharing ACLs). Use when the task mentions a workflow or automation on ERP, `async function main`, cron with seconds, webhook, `setEnv`, `runAndWait`, `kind: "agent"`, `erp.files`, uploading or downloading a file, a folder, Public/personal folder, presigned URL, trash/restore, checkpoints between runs, a hidden copilot conversation, a task board / kanban / a card for Arion, or when the user says "run this every morning", "sync nightly", "send a reminder email", "upload the report to ERP", "download the attached PDF", "share this folder", "file the report as a task", "move the card to review". Records, SQL, DataFrame and dashboards are the erp-data skill; building a web app is erp-miniapp; the wiki is erp-wiki.
---

# Using the ERP's tools

The object engine (tables, records, SQL) is **`erp-data`**. Everything else an
agent reaches through the SDK lives here: automation that runs on the server,
the document drive, the small stores around them, and the identity that
decides what any of it may touch.

This skill is a map, not a procedure. Each section says what the tool is for,
the few calls that do the job and the rules that cost the most when missed;
`references/` holds the full detail.

## 1. Connect, then check who you are

```bash
npx erp doctor     # env + connectivity + permissions → {ok, checks[]}
npx erp whoami     # which identity, and its effective IAM rules
```

```ts
import { createMiniApp } from "erp-sdk";

const erp = await createMiniApp({
  baseUrl: process.env.ERP_BASE_URL,
  apiKey: process.env.ERP_API_KEY,
  permissions: [{ resource: "file", action: "create" }],
});
```

`permissions` is a preflight: a missing pair throws `MissingPermissionsError`
with `.missing` before any real call. Without credentials, **ask** — never
guess a URL, a key or a name.

| Job | Tool | Permission |
| --- | --- | --- |
| Run something on a schedule, on a webhook, or on demand | `erp.workflows` | `workflow`, `workflow:run` (+ `ai:create` for an agent) |
| Store or fetch a document | `erp.files` | `file:*`, and `file:public:*` inside `Public` |
| Keep a cursor or checkpoint between runs | `erp.variables` | `workflow` (managing), granted per workflow (using) |
| Read what the copilot did | `erp.conversations` | the caller's own conversations only |
| Hand a report back as a card, or pick up the member's cards | `erp.tasks` | a session or personal key `erp_uk_…` — never a service account |
| Act as a specific user | `erp.asUser(accessToken)` | that user's own IAM and row scopes |

A mini app's `erp_sk_…` key is a `writer`: full on records, files and
dashboards, read-only on structure and the wiki. `erp.can(resource, action)`
answers before you try.

## 2. Workflows

ERP stores a trigger and what to run; no separate service. A workflow's
**`kind`** decides what one run does:

| `kind` | You store | A run |
| --- | --- | --- |
| `code` (default) | TypeScript with `async function main(input)` | the runner executes it, 60s, no retry |
| `agent` | a prompt ≤ 8 000 characters | opens a hidden copilot conversation and hands it over |

```ts
const wf = await erp.workflows.create({
  name: "Overdue reminders",
  code,
  trigger: { type: "cron", config: { schedule: "0 0 9 * * *", timezone: "Asia/Ho_Chi_Minh" } },
});
await wf.publish();

const run = await wf.runAndWait({});
runResult(run);
runLogs(run);
```

Prove a script before saving it — neither call stores anything:

```ts
await erp.workflows.check(code);                        // { valid, error? { message, line, column } }
await erp.workflows.testRun({ code, input, workflowId }); // real runner, record writes rolled back
```

The rules that break the most workflows:

- Triggers are **`manual`, `cron`, `webhook`** only — no record events.
- Cron is **6 fields with seconds** plus an IANA timezone: `"0 0 9 * * *"`.
- **Every `update` reverts to draft** and drops the cron; publish again.
- **`setEnv` replaces the whole map** — keep old names with `WORKFLOW_ENV_KEEP`.
- Inside `main()` only a fixed module registry imports: **no `node:fs`**, no
  `xlsx`. Outbound HTTP is open.
- A webhook URL **is the credential** and a secret; never print it, nor any env value.
- An agent workflow has no env, no variables, no `check`/`testRun`: running it
  is the only test and it writes real data. Its run's `SUCCESS` means *handed
  over*; read the outcome with `agentRunResult(run)` then `erp.conversations.get(id)`.

**Ask the user before creating, publishing, editing or deleting a workflow** —
it runs on real data, unattended, under the publisher's permissions.

## 3. The drive

Documents, not rows: a signed PDF, an exported spreadsheet, a photo.

```ts
const folder = await erp.files.personalFolder();        // or publicFolder()
const file = await erp.files.upload({
  folderId: folder.id,
  name: "bao-cao-thang-8.csv",
  content: csv,                                         // string | Uint8Array | ArrayBuffer | Blob
});

const { files } = await erp.files.list({ folderId: folder.id, search: "hợp đồng" });
const bytes = await erp.files.download(file.id);        // Uint8Array
const text = await erp.files.downloadText(file.id);     // string
const { downloadUrl } = await erp.files.downloadUrl(file.id);   // hand to a browser
```

- The root is not writable: it holds the caller's **personal** folder and
  **Public**. Every call names a `folderId` inside one of them.
- `upload()` is three steps in one (row → presigned PUT → complete). A failed
  PUT throws `FileUploadError` and strands the row in `uploading`.
- `mimeType` is inferred from the extension; unknown means
  `application/octet-stream`, which the wiki will not index.
- `downloadUrl` carries no ERP credential and expires: pass it on, never store it.
- Delete is trash for 7 days. `purgeFile`/`purgeFolder`/`emptyTrash` are the
  only irreversible calls.

## 4. Shared variables

Env is one workflow's **secrets**; `erp.variables` is **state** — plain strings,
readable again, granted to a list of workflows.

```ts
await erp.variables.create({ key: "invoice.cursor", value: "2026-08-01", workflowIds: [wf.id] });
await erp.variables.value("invoice.cursor");            // inside a run: undefined if not granted
await erp.variables.set("invoice.cursor", next);         // the only write a run can make
```

Creating, deleting and granting are a user session's job; a run that tries gets 403.

## 5. Copilot conversations

Read-only, and only the caller's own:

```ts
await erp.conversations.list({ visibility: "hidden" });   // visible (default) | hidden | all
const chat = await erp.conversations.get(conversationId);
chat.activeTurn;                                           // set while the agent still works
chat.messages.at(-1)?.content;
```

The conversation a cron agent workflow opens belongs to its publisher alone.

## 6. The AI task board

A personal kanban: each member has exactly one board per workspace, worked by
that member and **Arion** only. Arion files what it produced as a task — the
report in a markdown description, tags naming the analysis — and hands it back.

```ts
const board = await erp.tasks.board();                  // created on first call, with taskCounts
const { tasks } = await erp.tasks.list({ status: "review", tag: "inventory-analysis" });

const task = await erp.tasks.create({
  title: "Hàng chậm luân chuyển — tháng 8/2026",
  description: reportMarkdown,
  status: "review",
  tags: ["inventory-analysis"],
});
await erp.tasks.comment(task.id, "Đã đối chiếu với phiếu xuất kho.");
await erp.tasks.setStatus(task.id, "done");
```

- **Only a member reaches it**: a session or a personal key `erp_uk_…`. A service
  account key (`erp_sk_…`, every mini app) throws `TaskBoardError` before any
  request; from a mini app use `(await app.session(initData)).client.tasks`.
- **Everything is the caller's own board.** Another member's task is
  `UnknownTaskError`, and no admin override exists.
- Columns `todo` → `in_progress` → `review` → `done`, plus `archived`; priority
  `low` / `medium` / `high` / `urgent`.
- `dueDate` takes a `Date` or a full RFC 3339 timestamp — a bare date throws —
  and can't be cleared once set.
- `update(id, { metadata })` replaces the whole object.
- Nothing de-duplicates tasks: `list({ tag })` before filing the same report twice.
- Moving the member's own cards to `done` or deleting them is their call — ask.

Every method, shape, signing as an agent, limits: `references/task-board.md`.

## 7. Development mode across the tools

`ERP_ENV=development` makes record writes a server-side dry run. The tools here
mostly **are not records**, so they split three ways:

| Behaviour | Calls |
| --- | --- |
| Write for real | create/update/publish a workflow, `setEnv`, upload, rename, move, trash, restore a file; create, edit, move, assign, comment on and tag a task |
| Refuse with `DryRunUnsupportedError` | `wf.run()`, `variables.set/create/update/delete`, `purgeFile`, `purgeFolder`, `emptyTrash`, `tasks.delete`, `tasks.deleteComment` |
| Rehearse by construction | `workflows.testRun` — never blocked, the script's own SDK is in development |

Override one call with `{ dryRun: false }` once the user has agreed.

## Pitfalls

| Symptom | Cause |
| --- | --- |
| Edited code, run still returns the old result | Not republished after `update` |
| `Invalid cron schedule` on `"0 9 * * *"` | 5 fields; cron needs seconds |
| 409 `Workflow version conflict` | Stale handle: `await wf.refresh()` and retry |
| Secrets gone after adding one | `setEnv` replaced the map |
| Run right after `publish()` fails with a generic error | Runner has not seen the version yet; wait and retry |
| `Module "…" is not available` | Outside the runner's registry; nothing adds more |
| 403 uploading into Public | Needs `file:public:create`, not `file:create` |
| File stuck in `uploading` | The PUT failed; nothing completes it later |
| Drive root comes back empty | No `file:read`, not an empty drive |
| `erp.variables.value` is `undefined` in a run | The workflow is not in the variable's `workflowIds` |
| Agent run `SUCCESS`, nothing done yet | The run only hands over; the work continues in the conversation |
| Reading 0 rows | The actor's row scope, not the filter — `npx erp whoami` |
| `TaskBoardError` on `credential` | Service account key; the board needs a member's session or `erp_uk_` key |
| `UnknownTaskError` on a task id you know | It is on another member's board |

## References

- `references/workflows.md` — managing workflows through the SDK: both kinds,
  triggers and webhooks, lifecycle, env, shared variables, runs, the API table.
- `references/workflow-runtime.md` — what runs inside `main()`: globals, the
  module registry, limits, logs, error messages, trigger payloads.
- `references/workflow-patterns.md` — code that works there: idempotency,
  batching under the timeout, money with `decimal.js`, verifying webhook
  signatures, mail/Telegram/Slack, calling an LLM.
- `references/workflow-testing.md` — `check` and `testRun` in depth, what
  rehearses versus runs for real, and the checklist before handing a workflow over.
- `references/agent-workflows.md` — choosing between script and agent, writing
  a prompt that runs unattended, reading the conversation a run opens.
- `references/files.md` — the drive: system folders, uploads, listing and
  downloads, sharing, trash.
- `references/task-board.md` — the AI task board: who reaches it, every method
  and shape, what the SDK checks before sending, signing as an agent, limits, filing a report as a task.
- Records, SQL, `DataFrame`, dashboards → skill **`erp-data`**.
- `schema.json`, initData, deploying a web app → skill **`erp-miniapp`**.
- The wiki, attaching drive documents and `ask` → skill **`erp-wiki`**.
