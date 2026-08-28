---
name: erp-workflow
description: Write and edit code that runs inside Coconut ERP workflows — a TypeScript file with `async function main(input)` that the ERP server stores and runs on a schedule, when triggered manually, or via webhook. Use when the task involves writing/editing workflow code, `async function main`, workflow sandbox/runtime, which modules can be imported (node:fs is blocked), 6-field cron with seconds, webhooks and signature verification in code, draft/publish/version, `workflows.check` / `workflows.testRun`, workflow write-only env, shared variables/checkpoints between runs (`erp.variables`), runs with ERROR/timeout/no retry, or when users want to "run scheduled scripts on ERP", "send reminder emails each morning", "sync nightly", "automate on ERP". Managing workflows via SDK (create/publish/run/setEnv) is in the erp-data skill; building web apps uses erp-miniapp.
---

# Writing ERP Workflow Code

Workflows **are not** scripts running on your machine. They are TypeScript files that ERP
stores and runs in its own runner, within a tight sandbox. Running the file locally with
`node` proves nothing — it won't even start, because `erp`, `_`, `moment`, `axios`,
and `input` are **globals injected by the runner**, not available elsewhere.

**No steps, no nodes, no expression language.** The entire workflow is one function:

```ts
async function main(input) {
  // ...
  return { checked: 12, updated: 3 };   // → output.result of the run
}
```

Workflows have **`manual`**, **`cron`**, and **`webhook`** triggers. There's no record-event trigger
— to react to data changes, use cron polling or have the mini app call the workflow directly.

**A webhook is a secret URL, and that URL itself is the credential.** The server doesn't sign,
doesn't verify signatures, and doesn't know who's calling: it receives the request and queues
a run. The payload reaches `main(input)` **as-is**:

```ts
async function main(input) {
  // input = { source: "webhook", method, query, headers, body, receivedAt }
  const ok = await verify(input.body, input.headers["x-signature"]);
  if (!ok) return { rejected: true };      // return, don't throw — run ERROR is a false alarm
  const event = JSON.parse(input.body);
}
```

`input.body` is the **raw string exactly as sent**, not yet `JSON.parse`d. This is how verification works:
Stripe, GitHub, Shopify all sign the original bytes; parse then serialize again and the signature differs.
**Signature verification is this code's job**, not the server's — see `references/authoring.md` for
HMAC code using Web Crypto (`crypto.subtle`, available globally, no import needed).

Test it using **the same URL, plus `/test`** — runs even while the workflow is still a draft, and
in development mode, so record writes are validated in full and rolled back:

```ts
const url = new URL(wf.webhookUrl, process.env.ERP_BASE_URL);   // webhookUrl may be a relative path
const res = await fetch(`${url}/test`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-signature": signature },
  body: samplePayload,                                           // string, exact bytes the provider sends
});
// → 202 { id: "hooktest-…", status: "ENQUEUED" } — a run id, NOT the script's output
```

`/test` answers exactly as the live URL does: a run id, not what the script did. Whoever holds the
URL can start a rehearsal; **reading its logs and result takes the workflow's own read permission** —
`await wf.waitForRun(id)` / `wf.getRun(id)`, where every other run is read. Rehearsals carry a
`hooktest-` id prefix so the workflow's history never reports one as a real delivery.

This is the only way to prove the verify branch works: `test-run` with hand-typed input means you're faking
the signature, but `/test` goes through the same HTTP path the provider would take.

## 1. The mandatory loop: check → test-run → save → publish

**Never create a workflow just to see if the code runs.** Two SDK calls save nothing,
and they're where you fix bugs:

```ts
const report = await erp.workflows.check(code);
// → { valid: true } | { valid: false, error: { message, line?, column? } }

const t = await erp.workflows.testRun({
  code,
  input: {},
  workflowId: wf?.id,          // optional — see below
});
// → { ok, dryRun: true, result, logs, durationMs, error }

// On a workflow that already exists, this is the same call with its id filled in:
const t2 = await wf.testRun(code, {});
```

- `check` only transpiles: cheap, run after **every edit**. Invalid code comes back as
  `{ valid: false }` rather than throwing; a throw means the *request* failed (403, or
  503 = the runner is down).
- `test-run` **runs in the actual runner**, with `ERP_ENV=development` so
  create/update/bulk update get full server validation then **rollback**. This is how
  you catch wrong field names before bothering users.
- `ok: false` means **script error**, not request error — read `error.message`,
  `error.line`, `logs`, fix, and retry.
- **503 = runner is busy**, not code failure: wait a few seconds, resend **the exact
  same code**, don't rewrite it.
- **`workflowId` is what gets you env.** Passing the id of an existing workflow runs the
  script *as* that workflow: its stored env is decrypted for the run and its shared
  variables answer. Editing a workflow that already exists → always pass its id, or the
  script fails on a missing secret and you learn nothing. It takes **manage** access on
  that workflow — the same access that sets that env — and nothing is created or stored.
- **Without `workflowId` there is no env**: unsaved code belongs to no workflow, and no
  env may be supplied with the request either. `process.env` is `{}`. Write such a script
  to bail early (`if (!process.env.BOT_TOKEN) return { skipped: "missing env" }`) so the
  rest of the logic still proves itself.
- **Never print an env value** — not as a `return`, not via `console.log`. You are handed
  the workflow's secrets so the script can use them; anything you echo lands in a
  transcript that outlives the task. Name the variable, never its value.

What test-run **doesn't** rehearse and does for real: creating tables/fields, everything
sent outward (mail, bots, webhooks). `delete`, `restore`, link calls **refuse to run**
rather than pretend. Details: `references/testing.md`.

Only when `ok: true` do you call `erp.workflows.create(...)` then `publish()`. Ask
the user before creating/editing/deleting a workflow — it's something that will run
automatically on real data.

## 2. What's in the sandbox

Globals, **no import needed**: `erp` (ErpClient pointing to the right workspace,
using the run actor's identity), `_` (lodash), `moment`, `axios`, `input`, `env`,
`console`, `process` (fake version with only `env`, `argv`, `platform`, `version`).
`fetch` is Node's global so it works too.

Importable, and **only** these:

| Module | Alias | For |
| --- | --- | --- |
| `axios` | — | HTTP |
| `zod` | — | validate input |
| `decimal.js` | `decimal` | **money** |
| `nodemailer` | `email` | SMTP |
| `node-telegram-bot-api` | `telegram` | Telegram bot |
| `@slack/web-api` | `slack` | Slack |
| `yahoo-finance2` | `yfinance`, `yahoo-finance` | prices/rates |
| `ai` + `@ai-sdk/openai` \| `@ai-sdk/anthropic` \| `@ai-sdk/google` | — | LLM (ES-only: **import by name**) |
| `lodash`, `moment`, `erp-sdk` | — | full version of the globals |

Anything else → **400 at save time**, including `node:fs`, `node:child_process`,
`node:net`, `xlsx`, `csv-parse`. No disk, no child processes. **Outbound network is open** —
calling third-party APIs is the intended design.

## 3. Hard limits

| Item | Limit |
| --- | --- |
| Code | 128KB |
| `input` | 64KB JSON |
| `main()` return | 256KB, **must be JSON-serializable** |
| `console.*` | 64KB, over that is truncated (`… output truncated`) |
| 1 run | default **60s** (admins can extend to 15 min) |
| Parallel runs | 4/runner, exceeding that queues and 429s |
| Workflow name | ≤255, **unique per workspace** |

## 4. Six constraints that shape how you write code

**1. Runs never retry.** Failures or worker restarts mid-run
(`workflow run was interrupted and is not retried`) have no second chance, and everything already written
**stays written**. → Write **idempotent** code: pick work by state (`.where("Sent", "equals", false)`), mark it done immediately after, don't rely on "runs exactly once".

**2. 60 seconds is 60 seconds.** No sleeping to wait, no scanning 50,000 records in one run. → Each run
processes one batch with limits (`fetchAll({ max })`, `limit`), cron runs more often to drain the queue.

**3. Code runs with the permission of the person who triggered it** (for cron and webhooks: the publisher).
No service account, no "run with higher privilege". Permission errors are **real boundaries** — report them,
don't work around them.

**4. Secrets live only in workflow env**, read via `process.env.NAME` / `env.NAME`.
Never hardcode: code is stored verbatim in the DB and run history. Only **users** set values — you
supply the variable name and tell them what to set.

**State is the opposite: `erp.variables`** — a shared key/value store, where
one run leaves data for the next (checkpoints, sync cursors). Strings, readable again:

```ts
const since = (await erp.variables.value("invoice.cursor")) ?? "2026-01-01";
// … process from `since` …
await erp.variables.set("invoice.cursor", new_cursor);      // last line of script
```

`value()` returns `undefined` when nothing exists — normal on the first run, don't let it crash
the script. Scripts can **only set values**: creating, deleting, or changing the workflow list is
the user's job (403 if the script tries). It only sees variables the workflow is granted — ungranged
keys return 404 just like nonexistent keys, so when you need a new variable, **ask the user to create
it and grant it to this workflow**, with the key you used in code.

On test-run (`development`) **reads work normally, writes throw** `DryRunUnsupportedError` — a dry
run that silently moves a real cursor means the next real run skips data. To write for real: `{ dryRun: false }`.

**5. ERROR runs don't save logs.** Only the last few lines go into `error`. → Anything you need to debug
**return from `main()`**, and wrap risky sections in `try/catch` to return `{ ok: false, failed: [...] }`
instead of throwing.

**6. Money is `decimal.js`.** ERP stores decimal precision, JS `number` is float64 — adding/multiplying money
silently loses cents. `numeric` columns from SQL come back as JSON **strings**; pass the string as-is to
`Decimal`, return results via `.toString()`.

## 5. Traps already paid for

| Symptom | Cause |
| --- | --- |
| Code edited, but run still returns old result | Forgot `publish()` — **every update reverts workflow to draft** and removes cron; runs always use the published version |
| `Invalid cron schedule` with `"0 9 * * *"` | Cron is **6 fields with seconds**: `"0 0 9 * * *"`. Needs IANA `timezone` too |
| 409 `Workflow version conflict` | Version is optimistic locking, every mutation (including publish) bumps it → `await wf.refresh()` then retry |
| Import declared but no error, doesn't run either | Compiler strips unused imports **before** checking the registry |
| `Module "..." is not available` | Outside the registry in §2 — no way to add more |
| Run right after `publish()` returns generic `ERROR` `"Workflow run failed"` | Runner hasn't seen the new version yet, not a code error — wait a few seconds |
| Secrets vanish after adding a new key | `setEnv` **replaces the whole map**; send old names with `WORKFLOW_ENV_KEEP` (`"[KEEP]"`) |
| `erp.variables.value(...)` returns `undefined` even though user said they created it | This workflow is not in the variable's `workflowIds` — ask them to grant it, no way to grant yourself |
| `variables.set()` throws `DryRunUnsupportedError` during test-run | By design: setting variables has no dry run. Test the logic, then verify checkpoint persistence with `{ dryRun: false }` when the user approves |
| Webhook returns 404 even with correct URL | Workflow is still **draft** (every update reverts to draft), or trigger changed away from `webhook` — URL only lives with that trigger |
| Signature verification always fails | You `JSON.parse(input.body)` then sign. Sign the **raw string** `input.body`, parse after verification |
| Webhook returns 413 | Payload exceeds `WORKFLOW_MAX_INPUT_BYTES` (default 64KB) |
| Cron tick returns `{ skipped: true, reason }` | Old schedule (workflow edited/unpublished/deleted) — it auto-removes after that tick |
| `Workflow result is too large` | `main()` returned > 256KB — return aggregates, not entire tables |
| Reading 0 rows while UI shows data | Row scope is by **actor's** IAM, not filter mistake |

## 6. Before handoff

- [ ] `check` passes, `test-run` `ok: true` with real input.
- [ ] Running twice in a row doesn't double side effects (idempotent).
- [ ] All loops/`fetchAll` have limits, estimated to finish under 60s.
- [ ] No secrets in code; env var names needed are listed for the user.
- [ ] If the script keeps checkpoints: shared variable key is documented, and this workflow
      is already in its `workflowIds`.
- [ ] `main()` returns enough to understand what the run did, and it's small enough.
- [ ] Object/field names come from the real schema (`npx erp objects show`), not guesses.
- [ ] Cron: exactly 6 fields + timezone, and the user knows what hour it runs.
- [ ] Webhook: code verifies before doing anything, and **never prints the URL in reports** —
      that's a credential; just say "workflow has a webhook URL, see the workflow page".

Tell the user: workflow name/id/version/trigger, what the run returned or what error, missing
env var names, and what remains to do.

## References

- `references/runtime.md` — full runtime contract: globals, module registry,
  import rules, how much `process` is locked down, logs/result, error messages.
- `references/authoring.md` — working code patterns: idempotent, batching by timeout,
  money with `decimal.js`, sending mail/Telegram/Slack, calling LLM, validating
  `input` with zod.
- `references/testing.md` — `check`/`test-run` in detail, what rehearses vs. what
  runs for real, draft/publish/version lifecycle, reading run results.
- Managing workflows via SDK (`erp.workflows`, `setEnv`, `runAndWait`, sharing) →
  **`erp-data`** skill, `references/workflows.md`.
- Querying/writing data inside `main()` (RecordQuery, relations, DataFrame,
  SQL) → **`erp-data`** skill.
