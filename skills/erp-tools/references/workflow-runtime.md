# Workflow Runtime — Full Contract

The runner compiles code with esbuild (`loader: "ts"`, `format: "cjs"`,
`target: "node20"`) then calls it in an `AsyncFunction` with a fixed parameter list.
Every constraint below flows from that design.

## Entry point

Before transpiling, the runner checks the source for an `main` declaration with regex.
All these forms are accepted:

```ts
async function main(input) { … }            // preferred
const main = async (input) => { … }
export async function main(input) { … }
```

No `main` → `Workflow code must define "async function main()"` (400 at save time, or `ok: false` at test-run).

`main` receives `input` **and** `input` is also a global — two entry points to the same value.
No argument = `{}`, not `undefined`.

The return value goes straight through `JSON.stringify`:

- `undefined` → `null`.
- Non-serializable (`Map`, `Set`, `Date` nested in classes, circular refs) → data loss or error.
  Return plain objects/arrays.
- Over 256KB → `Workflow result is too large`, run becomes ERROR.

## Globals injected by the runner

| Name | What |
| --- | --- |
| `erp` | `new ErpClient(...)` pointing to the right workspace, using the run actor's token. **Not `createMiniApp`** — no permission preflight, errors bubble up |
| `_` | lodash |
| `moment` | moment.js |
| `axios` | axios |
| `input` | trigger payload (webhook: raw delivery — see §Trigger) |
| `env` | workflow env map (strings). Test-run: `{}` |
| `erp.variables` | Shared variables: key/value store across runs. Different from `env` — readable again, not secret (see below) |
| `process` | **frozen fake version**: `{ env, argv: [], platform, version }` |
| `console` | `log/info/warn/error/debug/table/trace` → `output.logs` |

Before code runs, the runner *locks down* the runtime: real `process.env` is deleted,
`process.binding`, `dlopen`, `getBuiltinModule`, `report`, `mainModule`, `kill` are removed;
`process.stdout.write`/`stderr.write` are replaced with log collection. That means no way
to read the server's environment variables, and no backdoor to system modules.

`fetch`, `URL`, `crypto`, `Buffer`, `setTimeout`… are still Node 20 globals.

## Shared variables — state between runs

`env` holds **secrets** (write-only, encrypted, reads back as `***`); `erp.variables` holds
**state** (strings, readable again, shared across workflows).

| Call | Does |
| --- | --- |
| `await erp.variables.value(key)` | Value, or `undefined` if missing / not granted |
| `await erp.variables.get(key)` | Full record; unreadable → `UnknownWorkflowVariableError` |
| `await erp.variables.set(key, value)` | Write — **the only write** one run can do |
| `await erp.variables.list()` | Variables this workflow is granted |

Four rules:

1. The run's token tells which **workflow** it is, so code only reaches variables that have
   it in `workflowIds`. Ungranged = 404, exactly like a nonexistent key — code can't tell
   the difference, and shouldn't try.
2. `create` / `delete` / changing `description` or `workflowIds` → **403** in the run.
   That's a workspace decision, made from a user session.
3. Last write wins, no versioning, no optimistic locking.
4. Limits: key `[A-Za-z][A-Za-z0-9_.-]*` ≤ 128 chars, value ≤ 16 384 chars, ≤ 100
   workflows per variable. Real data belongs in objects, this is just a cursor.

On `development` (all test-runs) **reads work, writes throw** `DryRunUnsupportedError`:
the server has no dry run for this, and a dry run that silently moves a real cursor means
the next real run skips data. `{ dryRun: false }` to write for real.

## Import: fixed registry

```ts
// correct: specifier is a literal string, at top level
import { z } from "zod";
import Decimal from "decimal";           // alias for decimal.js
import nodemailer from "email";
import { generateText } from "ai";       // ES-only → import by name
import { openai } from "@ai-sdk/openai";
```

| Canonical | Alias |
| --- | --- |
| `erp-sdk`, `lodash`, `moment`, `axios`, `zod`, `nodemailer`, `node-telegram-bot-api`, `@slack/web-api`, `yahoo-finance2`, `decimal.js`, `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google` | `decimal` → `decimal.js`, `email` → `nodemailer`, `telegram` → `node-telegram-bot-api`, `slack` → `@slack/web-api`, `yfinance`/`yahoo-finance` → `yahoo-finance2` |

Four rules:

1. **Specifier must be a literal.** `require(varName)` isn't caught at save time but throws at runtime;
   dynamic ES `import()` throws `must be imported with a literal specifier`.
2. **Unused imports get stripped by the compiler** before registry checking → declaring
   `import fs from "node:fs"` but not using it doesn't error, but you don't get `fs` either.
3. `ai` and `@ai-sdk/*` are ES-only: **named import**, never default import.
4. Everything else → `Module "x" is not available to workflows — available
   modules: …` (400 at save time, not runtime).

## Logging

`console.*` collects into `output.logs`, each line prefixed by level (`log: `,
`error: `…). 64KB cap for the whole run; over that inserts `log: … output truncated` and
**discards everything after**.

ERROR runs have **no `output`** — logs disappear, only ~3 final lines go into `error`
as `<error> [<log>]`. To debug a failed run, collect your trace in the return value:

```ts
async function main() {
  const trace = [];
  try {
    trace.push("started");
    …
    return { ok: true, trace };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e), trace };   // return, don't throw
  }
}
```

## Limits and environment variables controlling them

| Item | Limit | Variable |
| --- | --- | --- |
| Code | 128KB | `WORKFLOW_MAX_CODE_BYTES` |
| Input | 64KB JSON | — |
| Result | 256KB | `RUNNER_MAX_RESULT_BYTES` |
| Logs | 64KB | `RUNNER_MAX_LOG_BYTES` |
| 1 run duration | 60s default, technical cap 15 min | `WORKFLOW_RUN_TIMEOUT` |
| Parallel runs | 4/runner | `RUNNER_MAX_CONCURRENCY` |
| Env entries | 50, names `[A-Za-z_][A-Za-z0-9_]*` | — |
| Name / description | 255 / 2000 chars | — |

## Common error messages in `run.error`

| Message | Means |
| --- | --- |
| `<JS error> [<log>]` | code threw an exception |
| `Workflow code timed out after <N>ms` | exceeded timeout |
| `workflow run was interrupted and is not retried` | worker died/deployed mid-run — **no retry**, already-written data stays |
| `Workflow actor lacks workflow:run:create` | actor's permission was revoked (common with old crons) |
| `Workflow actor is not active` | actor disabled / left workspace |
| `Workflow result is too large` | `main()` returned > 256KB |
| `Workflow runner is busy` | runner overloaded — retry |
| `Workflow run failed` | infrastructure error (hidden); script errors are always more specific |

Errors at **save time** (400) are different: `Workflow code is required` / `is too large`
/ `is invalid: <message> (line N, column M)` / `Module "…" is not available` /
`Invalid cron schedule` / `Invalid cron timezone` /
`Manual trigger config must be empty` / `Webhook trigger config must be empty`.

The server **doesn't** validate object/field names in code — wrong names only surface at runtime
as `UnknownObjectError`/`UnknownFieldError` from the SDK. That's why `test-run` is not optional.

## Trigger

```jsonc
{ "type": "manual" }                       // config must be empty, extra keys → 400

{ "type": "cron", "config": {
    "schedule": "0 0 8 * * *",             // 6 fields: seconds minutes hours day month weekday
    "timezone": "Asia/Ho_Chi_Minh",        // IANA, required
    "automaticBackfill": false             // backfill missed ticks when recovering
} }

{ "type": "webhook" }                      // config must be empty too — URL is server-generated
```

- Descriptors like `@daily`, `@every 1h` are valid. `"0 9 * * *"` (5 fields) is not.
- Cron's `config` **rejects unknown keys**.
- Schedule is registered **only at publish**, and removed on update/delete.
- Cron runs receive `input = { source: "cron", scheduledAt: "<RFC3339>" }` —
  code should handle this plus manual inputs.
- Old schedule ticks return `SUCCESS` with `{ skipped: true, reason }`
  (`workflow schedule is stale` / `workflow no longer exists`) then auto-remove.

### Webhook

The server generates a secret URL when trigger becomes `webhook`, returned as `webhookUrl`
on the workflow (`wf.webhookUrl` in SDK), and revoked when the trigger changes.
`POST <url>` needs no session, no `X-Workspace-Id`: the token in the URL is the whole credential,
so **never print it in reports or logs**. The SDK only reads it: a leaked URL is retired by a
person at `POST /workflows/{id}/webhook/rotate` (manage access), which kills the old one
immediately and leaves code/version/published status alone. Ask the user to do that — you cannot,
and a script holding the old URL must not be able to mint itself a new one.

```jsonc
// input that main() receives
{
  "source": "webhook",
  "method": "POST",
  "query":  { "attempt": "1" },            // query string, split
  "headers": { "x-signature": "…" },       // intact, ready to verify
  "body": "{\"amount\":1250.50}",          // RAW STRING, not parsed
  "receivedAt": "2026-08-20T09:15:00Z"
}
```

- **Nothing is verified server-side.** Signed/unsigned, right/wrong, is the code's job — every
  request to the right URL costs one run.
- **`POST <url>/test` is a test run**: same URL, add `/test`. It delivers the script the exact
  payload the real URL would and responds **identically** — `202` with run id. Two differences:
  works even when workflow is **draft** (the place to test before publish), and runs in development
  mode so writes get validated then rolled back.
- The `/test` request **doesn't return logs or result**: read them from
  `GET /workflows/{id}/runs/{runId}` like any run, which requires read permission on the workflow.
  A webhook holder can only start a test, not see what the script did. Test-run ids are prefixed
  `hooktest-` so the run history doesn't mistake them for real deliveries.
- Returns `202` with run id immediately, **doesn't wait** for the script to finish: if you need
  a meaningful response body (Slack slash commands), webhooks aren't the answer.
- Draft returns `404`, unknown token returns `404`, changed trigger returns `404` — one answer,
  old URL reveals nothing.
- Payload over `WORKFLOW_MAX_INPUT_BYTES` (default 64KB) → `413`.
- Run executes with the permission of the **publisher**, same as cron.

## Permissions

Runs execute under the **live** permissions of the actor: whoever hit `POST /runs`, or whoever
published the workflow (for cron and webhooks). No service account, no privilege escalation.
Lose permission mid-run → ERROR on the next tick.

Two IAM resources: `workflow` (definitions) and `workflow:run` (executions) with
`create/read/update/delete`. `check` and `test-run` require `workflow:run:create`.

Workflows have their own ACL (`visibility: workspace | restricted`): `read` = see it,
`write` = **can hit play**, `manage` = edit/publish/delete/share. Cron **bypasses ACL**.
