# Testing workflow code

`check` and `testRun` store nothing — no workflow, run or version — so they are where
bugs get fixed. Creating a workflow just to see whether code runs leaves clutter, and
publishing a cron starts the schedule.

## Contents

- [`check` — transpile only](#check--transpile-only)
- [`testRun` — execute in the runner](#testrun--execute-in-the-runner)
- [What rehearses and what is real](#what-rehearses-and-what-is-real)
- [Webhook `/test`](#webhook-test)
- [The loop](#the-loop)
- [Before handing a workflow over](#before-handing-a-workflow-over)

Both calls need `workflow:run:create`:

```ts
import { readFile } from "node:fs/promises";
import { createMiniApp } from "erp-sdk";

const erp = await createMiniApp({
  baseUrl: process.env.ERP_BASE_URL,
  apiKey: process.env.ERP_API_KEY,
  permissions: [{ resource: "workflow:run", action: "create" }],
});
const code = await readFile("overdue-reminders.ts", "utf8");
```

## `check` — transpile only

```ts
const report = await erp.workflows.check(code);
if (!report.valid) {
  console.error(report.error?.message, "line", report.error?.line, "col", report.error?.column);
}
```

Cheap: run it after every edit. Invalid code is a **return value**
(`{ valid: false, error }`); it throws only when the request fails — 403 without the
permission, 503 when the runner itself is down.

It catches syntax errors, a missing `main`, modules outside the registry and code over
128 KB. It does not catch wrong object or field names, logic errors or missing
permissions.

## `testRun` — execute in the runner

```ts
const t = await erp.workflows.testRun({ code, input: { date: "2026-08-29" }, workflowId });
if (!t.ok) {
  console.error(t.error?.message, t.error?.line, t.error?.column, t.error?.timeout);
  console.error(t.logs?.join("\n"));
}
t.result;       // what main() returned
t.durationMs;
```

On an existing handle, `wf.testRun(code?, input?)` fills in `workflowId`, and without
`code` rehearses what the workflow holds:

```ts
const wf = await erp.workflow("Overdue reminders");
const t = await wf.testRun(newCode, { date: "2026-08-29" });
```

- `ok: false` means the **script** failed; the request itself was a 200.
- A 503 `Workflow runner is busy` is load, not your code: resend the same code shortly.
- Always ≤ 1 minute, whatever the deployment's run timeout.
- It runs under **your** token and reaches only what your key can. Zero rows? Check
  `npx erp whoami` before the filter.
- It is never blocked by `ERP_ENV=development`.

### Env and variables follow `workflowId`

| `workflowId` | The script gets |
| --- | --- |
| An existing workflow's id | Its stored env, and the shared variables granted to it — needs **manage** on that workflow, else 404 |
| Absent | No env (`env` is `{}`) and no variables |

When editing an existing workflow, always pass its id, or code that verifies signatures
or calls APIs fails for missing secrets. Env values reach the runner and never come
back — so never `return` or `console.log` them, since test output lands in the
transcript.

For code with no workflow yet, exit early when a secret is missing, prove the logic,
and prove the sending later with the smallest real run:

```ts
if (!env.BOT_TOKEN) return { skipped: "missing env BOT_TOKEN" };
```

## What rehearses and what is real

A test run puts the script's SDK in development mode:

| Operation | In a test run |
| --- | --- |
| `create`, `createMany`, `update`, bulk update | **Rehearsed** — validated in full, rolled back; returned ids are fake |
| `delete`, `restore`, `createLink`, `deleteLink`, starting another workflow | **Refused** with `DryRunUnsupportedError` |
| `variables.set` and other variable writes | **Refused** |
| `createObject`, `addField`, `ensureObject` | **Real** |
| Mail, Telegram, Slack, any outbound HTTP | **Real** |
| Reads, `erp.sql` | Real, read-only |

A relation written as a record field is rehearsed with the record; code that depends
on link calls only proves itself once saved.

## Webhook `/test`

`POST <webhookUrl>/test` delivers a payload exactly as the live URL would and answers
the same `202` with a run id, with two differences: it runs a **draft**, and it runs in
development mode. The response carries no logs or result — read them with
`wf.getRun(runId)`, which needs read access on the workflow. Its run ids start with
`hooktest-`.

On an **agent** workflow `/test` rehearses only the trigger: the copilot runs the prompt
for real and writes real data.

## The loop

```
edit → check → testRun (real input, workflowId when it exists) → ok?
         ▲                    │ no                                  │ yes
         └──── error.line / logs                                    ▼
                                            ask the user → create → publish → smallest real run
```

Never go straight from "code written" to create and publish.

## Before handing a workflow over

- [ ] `check` passes and `testRun` is `ok: true` on real input.
- [ ] Two runs in a row don't double any side effect.
- [ ] Every loop and `fetchAll` is bounded and fits in 60 seconds.
- [ ] No secret in the code; the env names it needs are listed for the user.
- [ ] Checkpoint variables are named, and this workflow is in their `workflowIds`.
- [ ] `main()` returns a small summary of what the run did.
- [ ] Object and field names came from `npx erp objects show`.
- [ ] Cron: 6 fields plus a timezone, and the user knows when it fires.
- [ ] Webhook: the code verifies before acting, and the URL appears in no report.

Report to the user: the workflow's name, id, version and trigger; what the run returned
or the error; missing env names; what is left to do.
