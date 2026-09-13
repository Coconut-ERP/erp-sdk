# Managing workflows

## Contents

- [Kinds](#kinds)
- [Lifecycle](#lifecycle)
- [Triggers](#triggers)
- [Env](#env)
- [Shared variables](#shared-variables)
- [Running and results](#running-and-results)
- [Actors, sharing and permissions](#actors-sharing-and-permissions)
- [API](#api)
- [Errors](#errors)

## Kinds

| `kind` | Holds | A run |
| --- | --- | --- |
| `code` (default) | `code` — TypeScript defining `async function main(input)` | the runner executes it |
| `agent` | `prompt` — ≤ 8,000 characters | opens a hidden copilot conversation with the prompt |

Triggers, draft/publish/version, webhook URLs, sharing and run history are the same
for both. What runs inside a script is `workflow-runtime.md`; everything specific to
agents is `agent-workflows.md`.

## Lifecycle

```
create ──► draft ──► publish() ──► active ──► runs (manual / cron / webhook)
             ▲                        │
             └────── any update() ────┘   publish again
```

```ts
const wf = await erp.workflows.create({
  name: "Overdue reminders",
  description: "Emails at 9am",
  code,
  trigger: { type: "cron", config: { schedule: "0 0 9 * * *", timezone: "Asia/Ho_Chi_Minh" } },
  env: { SMTP_PASSWORD: "…" },
});
await wf.publish();

const same = await erp.workflow("Overdue reminders");   // id → exact name → case-insensitive name
await same.update({ code: newCode });                   // back to draft
await same.publish();
```

- A draft does not run and its cron is not registered.
- **Every `update` returns the workflow to draft** and unregisters the cron.
- `version` is an optimistic lock that every mutation, `publish` included, bumps. A
  stale handle gets 409 `Workflow version conflict`: `await wf.refresh()`, then retry.
- Switching `kind` drops what the workflow held — code or prompt, and env when moving
  to `agent` — so `update` requires the replacement in the same call.

## Triggers

| Type | Config |
| --- | --- |
| `manual` | none — any key is a 400 |
| `cron` | `{ schedule, timezone, automaticBackfill? }`; unknown keys rejected |
| `webhook` | none — the server generates the URL |

- Cron has **6 fields, seconds first**: `"0 0 9 * * *"` is 09:00 daily; the 5-field
  `"0 9 * * *"` is rejected. Descriptors such as `@daily` and `@every 1h` work.
- `timezone` is IANA and required. `automaticBackfill: true` runs ticks missed during
  an outage.
- The schedule is registered at publish and removed by update or delete.
- There is no record-event trigger: poll by state on a cron, or have an app call
  `wf.run()`.

What `input` looks like for each trigger: `workflow-runtime.md`.

### Webhook URL

```ts
const hook = await erp.workflows.create({ name: "Payment received", code, trigger: { type: "webhook" } });
await hook.publish();      // a draft's URL answers 404
hook.webhookUrl;           // "https://…/api/v1/webhooks/<token>"
```

- **The URL is the whole credential**: anyone holding it starts runs, and the server
  checks no signature. Never log it or put it in a report — point the user to the
  workflow's page.
- Changing the trigger away from `webhook` revokes it.
- A leaked URL is rotated by a person with manage access at
  `POST /workflows/{id}/webhook/rotate`; the SDK only reads the URL. Ask the user.
- Verifying the caller is the script's job (`workflow-patterns.md`); rehearsing through
  `<webhookUrl>/test` is `workflow-testing.md`.

## Env

```ts
await wf.setEnv({ SMTP_PASSWORD: WORKFLOW_ENV_KEEP, BOT_TOKEN: "new-token" });
wf.envNames;   // names only — values never come back
```

- **`setEnv` replaces the whole map.** A name you don't send is gone; send
  `WORKFLOW_ENV_KEEP` (`"[KEEP]"`) to keep a value you cannot read.
- ≤ 50 entries (`MAX_WORKFLOW_ENV_ENTRIES`), names matching `[A-Za-z_][A-Za-z0-9_]*`.
- It does not bump `version`, return to draft or touch the cron; the next run sees it.
- Agent workflows have no env.

## Shared variables

State shared across runs and workflows: plain strings, readable again, not secret.

```ts
await erp.variables.create({
  key: "invoice.cursor",
  value: "2026-08-01",
  description: "Invoice sync cursor",
  workflowIds: [wf.id, other.id],                    // read and write; no read-only grant
});
await erp.variables.update("invoice.cursor", { workflowIds: [wf.id] });   // replaces the list
await erp.variables.list();
await erp.variables.delete("invoice.cursor");

// inside a run
await erp.variables.value("invoice.cursor");         // undefined when missing or not granted
await erp.variables.get("invoice.cursor");           // record; UnknownWorkflowVariableError otherwise
await erp.variables.set("invoice.cursor", next);
```

- A run reaches only variables whose `workflowIds` include its workflow; anything else
  is indistinguishable from a missing key. `set` is its only write — create, delete,
  `description` and `workflowIds` changes are 403 there.
- An empty `workflowIds` grants no run; every id must be a workflow in the workspace.
- Last write wins; no versioning.
- Key `[A-Za-z][A-Za-z0-9_.-]*` ≤ 128 chars, value ≤ 16,384 chars, ≤ 100 workflows.
  Real data belongs in objects.
- In development mode reads work and writes throw `DryRunUnsupportedError` — a
  rehearsal that moved a real cursor would make the next real run skip data.
- Agent workflows cannot use them; keep an agent's checkpoint in a record or a page.

## Running and results

```ts
const run = await wf.runAndWait({ date: "2026-08-14" });
runResult(run);   // what main() returned
runLogs(run);     // console lines

const started = await wf.run(input);                                    // ENQUEUED, returns at once
const finished = await wf.waitForRun(started.id, { timeoutMs: 120_000 });
await wf.runs({ limit: 20, offset: 0 });
```

- Statuses: `ENQUEUED` → `PENDING` → `SUCCESS` | `ERROR` (`isRunFinished`).
- `ERROR` makes `waitForRun` throw `WorkflowRunFailedError`; `.run.error` holds what the
  script threw plus its last log lines.
- A wait that times out throws `WorkflowRunTimeoutError` but **does not cancel the run**;
  read it later with `wf.getRun(runId)`.
- `run.output` is a JSON string; read it through `runOutput` / `runResult` / `runLogs`.
- A run right after `publish()` can fail with a generic `Workflow run failed` because
  the runner has not picked up the version yet; wait a few seconds and retry.
- `wf.run()` throws `DryRunUnsupportedError` in development mode — a run is real.
  `wf.run(input, { dryRun: false })` overrides once the user agrees. Defining a
  workflow always writes for real.

## Actors, sharing and permissions

- A run acts as its **actor**, under that actor's live permissions: whoever started a
  manual run, and whoever published the workflow for cron and webhook runs. There is
  no service account in a run, so no escalation; an actor who loses a permission makes
  the next run fail.
- IAM resources: `workflow` (definitions) and `workflow:run` (executions), each with
  `create` / `read` / `update` / `delete`. `check` and `testRun` need
  `workflow:run:create`; an agent workflow also needs `ai:create`.
- The workflow ACL (`visibility: workspace | restricted`): `read` sees it, `write` can
  run it, `manage` edits, publishes, deletes and shares. Cron ignores the ACL.

## API

| Member | Notes |
| --- | --- |
| `erp.workflows.list({ limit?, offset? })` · `listAll()` | Without `code`; use `listAll` — pages are filtered after paginating |
| `erp.workflows.create({ name, code, trigger, description?, env? })` | Script workflow, returned as a draft |
| `erp.workflows.create({ name, kind: "agent", prompt, trigger, description? })` | Agent workflow |
| `erp.workflows.check(code)` · `testRun({ code, input?, workflowId? })` | `workflow-testing.md` |
| `erp.workflow(nameOrId)` | Handle, with `code` loaded |
| `wf.id` · `name` · `version` · `status` · `isPublished` · `trigger` · `code` · `envNames` · `meta` | |
| `wf.kind` · `isAgent` · `prompt` | `prompt` is `""` on a script workflow |
| `wf.webhookUrl` | Webhook trigger only; read-only credential |
| `wf.update({ name?, description?, trigger?, code?, prompt?, kind?, version? })` | Back to draft |
| `wf.publish(version?)` · `refresh()` · `delete(version?)` | |
| `wf.setEnv(env)` | Replaces the map |
| `wf.testRun(code?, input?)` | `testRun` as this workflow |
| `wf.run(input?, { dryRun? })` · `runAndWait(input?, options?)` | |
| `wf.waitForRun(runId, { timeoutMs?, intervalMs?, throwOnError? })` | Defaults 120,000 ms / 1,000 ms / throw |
| `wf.runs({ limit?, offset? })` · `getRun(runId)` | |
| `wf.sharing()` · `setSharing(visibility, entries?)` | `"workspace"` \| `"restricted"` |
| `erp.variables.list()` · `get` · `value` · `create` · `update` · `set` · `delete` | |
| `runOutput` · `runResult` · `runLogs` · `agentRunResult` | Unpack a run |
| `erp.conversations.list({ visibility?, page?, perPage? })` · `listAll()` · `get(id)` | Caller's own, read-only |
| `isRunFinished` · `WORKFLOW_TRIGGER_TYPES` · `WORKFLOW_ENV_KEEP` · `MAX_WORKFLOW_ENV_ENTRIES` · `MAX_WORKFLOW_PROMPT_CHARS` | |

## Errors

| Class | Fields |
| --- | --- |
| `UnknownWorkflowError` | `.workflow`, `.known` |
| `WorkflowDefinitionError` | `.field` (`kind` \| `trigger` \| `code` \| `prompt` \| `env` \| `variable`), `.reason` — thrown before sending |
| `WorkflowRunFailedError` | `.workflow`, `.run.error` |
| `WorkflowRunTimeoutError` | `.workflow`, `.run`, `.timeoutMs` — the run continues |
| `UnknownWorkflowVariableError` | `.key` |
| `DryRunUnsupportedError` | `.operation` |
