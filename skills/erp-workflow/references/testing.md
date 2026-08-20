# Testing Workflow Code Before It Becomes a Workflow

The two endpoints below **save nothing**: no workflow, no run, no version.
They're where you fix bugs — creating a workflow just to see if code runs leaves trash for others,
and if the trigger is cron, publish even activates the schedule.

Neither has an SDK method yet, but `erp.http` is public so you can call them directly,
still going through proper auth and unwrapping the `{success, data}` envelope:

```ts
import { createMiniApp, ErpApiError } from "erp-sdk";

const erp = await createMiniApp({
  baseUrl: process.env.ERP_BASE_URL,
  apiKey: process.env.ERP_API_KEY,
  permissions: [{ resource: "workflow:run", action: "create" }],
});

const code = await readFile("reminder-overdue-orders.ts", "utf8");
```

## 1. `POST /workflows/check` — transpile, don't run

```ts
try {
  await erp.http.request("POST", "/workflows/check", { body: { code } });
  // → { valid: true }
} catch (e) {
  if (e instanceof ErpApiError) console.error(e.message);
  // "Workflow code is invalid: Expected ";" (line 12, column 8)"
  // "Workflow code is invalid: Module "node:fs" is not available to workflows — available modules: …"
  // "Workflow code must define "async function main()""
}
```

Cheap and fast. Run after every edit, before spending a test-run.

It catches: TypeScript syntax, missing `main`, modules outside the registry, code > 128KB.
It **doesn't** catch: wrong object/field names, logic errors, missing permissions — that's test-run's job.

## 2. `POST /workflows/test-run` — run in the actual runner

```ts
interface TestRun {
  ok: boolean;
  dryRun: true;
  result: unknown;
  logs: string[];
  durationMs: number;
  error?: { message: string; line?: number; column?: number; timeout?: boolean };
}

const t = await erp.http.request<TestRun>("POST", "/workflows/test-run", {
  body: { code, input: { date: "2026-08-14" }, workflowId: wf?.id },
});

if (!t.ok) {
  console.error(t.error?.message, "line", t.error?.line, t.error?.column);
  console.error(t.logs.join("\n"));
}
```

- `ok: false` means **script is broken**, request still 200. Read `error.message`,
  `error.line`, `logs` → fix → retry. `error.timeout: true` means you hit the limit.
- **503 `Workflow runner is busy`** means the runner is overloaded, **not** a code error:
  wait a few seconds then resend the exact same code, don't rewrite the script.
- Hard **1 minute limit** for test-run (even if admins extended `WORKFLOW_RUN_TIMEOUT`).
- Requires `workflow:run:create` permission — same as running a real workflow.
- Runs under **your token**: the script can only reach what your key can reach. Reading 0 rows?
  Check `npx erp whoami` first before blaming the filter.

### What rehearses, what runs for real

Test-run always puts the SDK in `development`, so:

| Script operation | In test-run |
| --- | --- |
| `create`, `createMany`, `update`, bulk update by filter | **Dry run**: server validates fully (field, unique, version, id relation, rule, computed) then **rolls back**. Returned id is **fake**, don't use it later |
| `delete`, `restore`, `createLink`, `deleteLink`, running another workflow | **Rejected** — throws `DryRunUnsupportedError` rather than pretend |
| `createObject`, `addField`, `ensureObject` | **Real** — table structure has no dry run |
| Mail, Telegram, Slack, webhooks, any outbound HTTP | **Real** — sending is sending |
| Reads (`fetch`, `count`, `erp.sql`) | Real, read-only |

Relations written **like a record field** get rehearsed with the record;
`createLink`/`deleteLink` don't — scripts depending on link operations only prove themselves
after the workflow is saved.

### Env: only when you pass `workflowId`

`workflowId` is optional, and it decides what identity the script runs as:

| `workflowId` | Script is granted |
| --- | --- |
| **Present** — id of an existing workflow | The workflow's saved env (decrypted, sent directly to the runner), and shared variables the workflow is granted (`erp.variables`). Token carries a `wfid` claim, so `erp.variables` is pinned to the grant list: keys outside that list return 404, and the run can only change `value` not `description`/`workflowIds` |
| **Absent** | No env (`process.env` is `{}`), no `wfid`. The request **can't** even send env |

Editing code for an existing workflow **always pass its id**; otherwise, scripts verifying
signatures or calling APIs with a key will break from missing secrets — not what you're testing.
You need **manage** on that workflow, same permission to set env and save code for it;
another workspace or no manage access = 404. Nothing is saved: no new workflow, no run.

Env is delivered to the runner **only, never returned to the caller** — all endpoints still show
`***`. So: **never print env values** — not in `return`, not in `console.log`. Test-run logs stay
in the transcript.

For code not yet in a workflow, if the script needs secrets, write an early exit:

```ts
if (!process.env.BOT_TOKEN) return { skipped: "missing env BOT_TOKEN" };
```

so test-run still proves the logic, and the sending part is proven later — with a real run,
as minimal as you can make it (one recipient, one row).

## 3. After `ok: true`: save, publish

Now use the SDK (details in the **`erp-data`** skill, `references/workflows.md`):

```ts
const wf = await erp.workflows.create({
  name: "Overdue reminders",
  description: "Cron at 9am",
  code,
  trigger: { type: "cron", config: { schedule: "0 0 9 * * *", timezone: "Asia/Ho_Chi_Minh" } },
});
await wf.publish();            // draft doesn't run, cron isn't registered yet
```

Three lifecycle rules, miss one and you're debugging for hours:

1. **Every `update` reverts workflow to `draft` and removes the cron.** After editing,
   `publish()` again or the run still uses the old active version.
2. **`version` is optimistic locking**, every mutation (including `publish`) bumps it. Wrong version?
   → 409 `Workflow version conflict` → `await wf.refresh()` then retry.
3. **`setEnv` replaces the whole map**: names you don't send are gone. Keep old values with
   the sentinel `WORKFLOW_ENV_KEEP` (`"[KEEP]"`). Changing env **doesn't** bump version,
   doesn't revert to draft, doesn't cancel the cron.

## 4. Reading results from a real run

```ts
const run = await wf.runAndWait({ date: "2026-08-14" });
runResult(run);   // value main() returned
runLogs(run);     // console.log lines
```

- `wf.run()` is blocked when the client is in `ERP_ENV=development` (`DryRunUnsupportedError`)
  — running a workflow writes for real, no dry run on the server. To override:
  `wf.run(input, { dryRun: false })`.
- Timeout waiting → `WorkflowRunTimeoutError`, **run is not cancelled**, query it again with
  `wf.getRun(runId)`.
- **Run right after `publish()`** sometimes ERROR with a generic `"Workflow run failed"`:
  runner hasn't seen the new version yet. Wait a few seconds, retry.
- ERROR runs **have no logs** — only the last few lines go into `error`.

## Workflow, condensed

```
edit file  →  check  →  test-run (real input)  →  ok?
                ↑          ↓ no                    ↓ yes
                └──── read error.line/logs      ask user
                                                   ↓
                                    create → publish → smallest real run
```

Never jump from "done writing" to "create + publish": a published cron is something
running on real data, every day, under the publisher's permissions.
