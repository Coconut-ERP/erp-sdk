---
name: erp-tools
description: Uses the Coconut ERP's tools beyond records through erp-sdk — workflows (script or agent; manual, cron and webhook triggers; draft/publish; env; runs; `check` and `testRun`; the runner sandbox), the drive (folders, upload, download, sharing, trash), shared variables, copilot conversations, and a member's AI task board shared with Arion. Use when something should run on a schedule or a webhook ("every morning", "sync nightly", "send a reminder email"), when a document goes to or comes from the ERP ("upload the report", "download the attached PDF", "share this folder"), when a run needs a checkpoint, or when a card is filed or moved on the task board. Records, SQL and dashboards are erp-data; web apps are erp-miniapp; the wiki is erp-wiki.
---

# The ERP's tools beyond records

Records, SQL and dashboards are skill `erp-data`. This skill covers automation that
runs on the server, the document drive, the small stores around them, and the identity
that decides what each may touch. Each section gives the calls that do the job and the
rules that cost most when missed; `references/` holds the detail.

## 1. Connect, then check who you are

```bash
npx erp doctor     # env, connectivity, permissions → {ok, checks[]}
npx erp whoami     # identity and effective IAM rules
```

```ts
import { createMiniApp } from "erp-sdk";

const erp = await createMiniApp({
  baseUrl: process.env.ERP_BASE_URL,
  apiKey: process.env.ERP_API_KEY,
  permissions: [{ resource: "file", action: "create" }],   // preflight → MissingPermissionsError
});
```

Without credentials, ask — never guess a URL, key or name.

| Job | Tool | Needs |
| --- | --- | --- |
| Run something on a schedule, a webhook or on demand | `erp.workflows` | `workflow`, `workflow:run` (+ `ai:create` for an agent) |
| Store or fetch a document | `erp.files` | `file:*`; `file:public:*` inside `Public` |
| Keep a checkpoint between runs | `erp.variables` | `workflow` to manage; a grant to use |
| Read what the copilot did | `erp.conversations` | the caller's own conversations |
| File a report as a card, or read the member's cards | `erp.tasks` | a member's session or `erp_uk_…` key — never `erp_sk_…` |
| Act as a specific user | `erp.asUser(accessToken)` | that user's IAM and row scope |

A service-account key (`erp_sk_…`) is a `writer`: full on records, files and
dashboards, read-only on structure and the wiki. `await erp.can(resource, action)`
answers before you try.

## 2. Workflows

The ERP stores the trigger and what to run; there is no separate service.

| `kind` | Stores | One run |
| --- | --- | --- |
| `code` (default) | TypeScript with `async function main(input)` | the runner executes it — 60 s, no retry |
| `agent` | a prompt ≤ 8,000 characters | opens a hidden copilot conversation and hands it over |

Prove a script before saving it — neither call stores anything:

```ts
await erp.workflows.check(code);                          // { valid, error? { message, line, column } }
await erp.workflows.testRun({ code, input, workflowId }); // real runner, record writes rolled back
```

Then save, publish and run:

```ts
const wf = await erp.workflows.create({
  name: "Overdue reminders",
  code,
  trigger: { type: "cron", config: { schedule: "0 0 9 * * *", timezone: "Asia/Ho_Chi_Minh" } },
});
await wf.publish();

const run = await wf.runAndWait({});
runResult(run);   // what main() returned
runLogs(run);
```

Rules that break the most workflows:

- Triggers are `manual`, `cron` and `webhook` only — nothing fires on record changes.
- Cron has **6 fields, seconds first**, plus an IANA timezone: `"0 0 9 * * *"`.
- **Every `update` returns the workflow to draft** and unregisters its cron; publish again.
- **`setEnv` replaces the whole map**; keep existing names with `WORKFLOW_ENV_KEEP`.
- Code imports only from the runner's fixed registry (`references/workflow-runtime.md`)
  — no `node:fs`, no child processes. Outbound HTTP is open.
- A webhook URL **is a credential**. Never print it, or any env value.
- An agent workflow has no env, no variables, no `check` / `testRun`: running it is the
  only test, and it writes real data. `SUCCESS` means handed over — read the outcome
  with `agentRunResult(run)` and `erp.conversations.get(id)`.

**Ask the user before creating, publishing, editing or deleting a workflow** — it runs
unattended, on real data, under the publisher's permissions.

## 3. The drive

For documents, not rows: a signed PDF, an exported spreadsheet, a photo.

```ts
const folder = await erp.files.personalFolder();        // or publicFolder()
const file = await erp.files.upload({
  folderId: folder.id,
  name: "bao-cao-thang-8.csv",
  content: csv,                                         // string | Uint8Array | ArrayBuffer | Blob
});

const { files } = await erp.files.list({ folderId: folder.id, search: "hợp đồng" });
const bytes = await erp.files.download(file.id);        // Uint8Array; downloadText() for a string
const { downloadUrl } = await erp.files.downloadUrl(file.id);   // for a browser; expires
```

- The root holds only the caller's **personal** folder and **Public**; every call names
  a `folderId` inside one of them.
- `upload()` is three steps in one. A failed PUT throws `FileUploadError` and leaves the
  row stuck in `uploading`.
- `mimeType` is inferred from the extension; an unknown one becomes
  `application/octet-stream`, which the wiki will not index.
- A `downloadUrl` carries no ERP credential and expires: hand it on, never store it.
- Deleting moves to trash for 7 days.

## 4. Shared variables

Env holds one workflow's **secrets**; `erp.variables` holds **state** — plain strings,
readable again, granted to a list of workflows.

```ts
await erp.variables.create({ key: "invoice.cursor", value: "2026-08-01", workflowIds: [wf.id] });
await erp.variables.value("invoice.cursor");     // in a run: undefined unless granted
await erp.variables.set("invoice.cursor", next);  // the only write a run can make
```

Creating, deleting and granting happen from a user session; a run that tries gets 403.

## 5. Copilot conversations

Read-only, and only the caller's own:

```ts
await erp.conversations.list({ visibility: "hidden" });   // visible (default) | hidden | all
const chat = await erp.conversations.get(conversationId);
chat.activeTurn;                                           // set while the agent still works
chat.messages.at(-1)?.content;
```

## 6. The AI task board

A personal kanban: one board per member per workspace, worked only by that member and
**Arion**. Arion files what it produced as a task — the report as markdown in the
description, tags naming the analysis — and hands it back.

```ts
const { tasks } = await erp.tasks.list({ tag: "slow-moving-2026-08" });
if (tasks.length === 0) {
  const task = await erp.tasks.create({
    title: "Hàng chậm luân chuyển — tháng 8/2026",
    description: reportMarkdown,
    status: "review",
    tags: ["slow-moving-2026-08", "inventory-analysis"],
  });
  await erp.tasks.comment(task.id, "Đã đối chiếu với phiếu xuất kho.");
}
```

- **Only a member reaches it.** A service-account key throws `TaskBoardError` before any
  request; from a mini app use `(await app.session(initData)).client.tasks`.
- **Every call is scoped to the caller's own board**; another member's task is
  `UnknownTaskError`, with no admin override.
- Nothing de-duplicates: look up by tag before filing.
- Moving the member's cards to `done`, deleting, or rewriting their description is
  their call — ask.

## 7. Development mode across these tools

`ERP_ENV=development` makes record writes a server-side dry run. Most of what is here
is not records, so each call falls into one of three groups:

| Behaviour | Calls |
| --- | --- |
| Writes for real | create, update, publish a workflow; `setEnv`; upload, rename, move, trash, restore a file; create, edit, move, assign, comment on and tag a task |
| Refuses with `DryRunUnsupportedError` | `wf.run()`; `variables.set` / `create` / `update` / `delete`; `purgeFile`, `purgeFolder`, `emptyTrash`; `tasks.delete`, `tasks.deleteComment` |
| Rehearses by construction | `workflows.testRun` — never blocked; the script's own SDK runs in development mode |

Pass `{ dryRun: false }` to one refused call once the user has agreed.

## Pitfalls

| Symptom | Cause |
| --- | --- |
| Edited code, runs still behave the old way | Not published again after `update` |
| 409 `Workflow version conflict` | Stale handle — `await wf.refresh()` and retry |
| A run right after `publish()` fails with `Workflow run failed` | The runner hasn't picked up the version; wait and retry |
| `Module "…" is not available to workflows` | Not in the registry; the message lists what is |
| 403 uploading into `Public` | Needs `file:public:create` |
| Drive root comes back empty | No `file:read`, not an empty drive |
| `erp.variables.value` is `undefined` in a run | The workflow is not in the variable's `workflowIds` |
| Agent run `SUCCESS`, nothing done yet | The work continues in the conversation |
| Reading 0 rows | The actor's row scope — `npx erp whoami` |
| `TaskBoardError` on `credential` | A service-account key; use a member's session or `erp_uk_` key |

## References

- `references/workflows.md` — managing workflows: lifecycle, triggers, webhook URLs,
  env, shared variables, runs, sharing and actors, API and errors.
- `references/workflow-runtime.md` — inside `main()`: globals, the module registry,
  logs, limits, run errors, trigger payloads.
- `references/workflow-patterns.md` — code that works there: idempotency, time
  budgets, money, input validation, webhook signatures, outbound messages, LLM calls.
- `references/workflow-testing.md` — `check`, `testRun`, webhook `/test`, what
  rehearses versus runs for real, the hand-over checklist.
- `references/agent-workflows.md` — script or agent, writing an unattended prompt,
  reading the conversation a run opens.
- `references/files.md` — the drive: folders, uploads, listing, downloads, sharing, trash.
- `references/task-board.md` — the task board: access, methods, validation,
  authorship, limits, filing a report.
- Skill `erp-data` — records, SQL, `DataFrame`, dashboards.
- Skill `erp-miniapp` — `schema.json`, initData, deploying a web app.
- Skill `erp-wiki` — the wiki, attaching drive documents, `ask`.
