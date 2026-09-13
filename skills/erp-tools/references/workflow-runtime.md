# Inside a script workflow

What the runner gives `main()`, what it refuses, and how a run fails. Everything here
is about `kind: "code"`.

## Contents

- [Entry point](#entry-point)
- [Globals](#globals)
- [Modules](#modules)
- [Logs](#logs)
- [Limits](#limits)
- [Run errors](#run-errors)
- [Trigger input](#trigger-input)

## Entry point

```ts
async function main(input) { … }            // preferred
const main = async (input) => { … }
export async function main(input) { … }
```

Without one: `Workflow code must define "async function main()"` — a 400 on save,
`ok: false` in a test run. `input` is passed to `main` and is also a global; with no
input it is `{}`.

The return value goes through `JSON.stringify`: `undefined` becomes `null`, `Map` /
`Set` / class instances lose data, and more than 256 KB fails the run with
`Workflow result is too large`. Return plain objects — counts and error lists, not
tables.

## Globals

| Name | What |
| --- | --- |
| `erp` | An `ErpClient` for the workspace, on the run actor's token — no permission preflight. `erp.files`, `erp.variables`, `erp.sql` and the rest all work |
| `_` · `moment` · `axios` | lodash, moment, axios |
| `input` | The trigger's input |
| `env` | The workflow's env as strings; `process.env` is the same object |
| `console` | `log` / `info` / `warn` / `error` / `debug` / `table` / `trace` → the run's logs |
| `process` | A frozen stub: `{ env, argv: [], platform, version }` |

Node 20 globals remain: `fetch`, `URL`, `Buffer`, `TextEncoder`, `setTimeout`, and
`crypto` as Web Crypto. The server's real environment and native hooks are removed
before the code runs; there is no disk and no child process. Outbound network is open.

## Modules

Imports resolve against a fixed registry. Anything else fails **at save time** with
`Module "x" is not available to workflows — available modules: …`, and that message is
the authoritative list.

| Area | Modules (aliases) |
| --- | --- |
| Core | `erp-sdk`, `lodash`, `moment`, `axios`, `zod`, `decimal.js` (`decimal`), `node:crypto` (`crypto`), `jose`, `jsonwebtoken` (`jwt`), `form-data`, `mime-types` (`mime`), `bottleneck` |
| Messaging | `nodemailer` (`email`), `node-telegram-bot-api` (`telegram`), `@slack/web-api` (`slack`), `discord.js` (`discord`), `@line/bot-sdk` (`line`), `@microsoft/microsoft-graph-client` (`msgraph`, `teams`, `outlook`), `@azure/identity`, `twilio` |
| Google | `@googleapis/sheets` (`sheets`), `@googleapis/drive` (`drive`), `@googleapis/gmail` (`gmail`), `@googleapis/calendar` (`calendar`), `google-auth-library`, `google-spreadsheet` |
| CRM and work | `@hubspot/api-client` (`hubspot`), `jsforce` (`salesforce`), `@notionhq/client` (`notion`), `airtable`, `@octokit/rest` (`github`, `octokit`), `jira.js` (`jira`), `@linear/sdk` (`linear`), `pipedrive` |
| Commerce and finance | `stripe`, `@paypal/paypal-server-sdk` (`paypal`), `shopify-api-node` (`shopify`), `@woocommerce/woocommerce-rest-api` (`woocommerce`), `yahoo-finance2` (`yfinance`, `yahoo-finance`) |
| Files and formats | `exceljs` (`excel`, `xlsx`), `papaparse`, `csv-parse` (`csv`), `fast-xml-parser` (`xml`), `pdf-lib` (`pdf`), `jszip` (`zip`), `handlebars`, `qrcode`, `cheerio` (`html`) |
| AI | `ai`, `openai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/google-vertex`, `@ai-sdk/azure`, `@ai-sdk/amazon-bedrock`, `@ai-sdk/mistral`, `@ai-sdk/deepseek`, `@ai-sdk/groq`, `@ai-sdk/xai`, `@ai-sdk/cohere`, `@ai-sdk/perplexity`, `@ai-sdk/openai-compatible` |

- **Static imports with literal specifiers.** ES-only packages — `ai`, `@ai-sdk/*`,
  `jose`, `@octokit/rest`, `jira.js` — are loaded ahead of time from those imports, so
  a dynamic `import()` of one throws `must be imported with a literal specifier`.
  Import them by name (`import { generateText } from "ai"`), not as a default.
- **Aliases are the real package.** `xlsx` gives ExcelJS's API, not SheetJS's.
- **Unused imports are stripped** before the check, so an unused `import fs from
  "node:fs"` saves without error and provides nothing.

## Logs

`console.*` lines are collected with a level prefix (`log: `, `error: `). Past 64 KB
the rest of the run's output is dropped after a truncation marker.

A run that ends in `ERROR` keeps **no logs** — only its last few lines are folded into
`error` as `<error> [<log>]`. To debug, catch and return a trace:

```ts
async function main() {
  const trace = [];
  try {
    trace.push("started");
    …
    return { ok: true, trace };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e), trace };
  }
}
```

## Limits

| Item | Limit |
| --- | --- |
| Code | 128 KB |
| Input | 64 KB of JSON (a larger webhook body → 413) |
| Result | 256 KB |
| Logs | 64 KB |
| One run | 60 s by default (the deployment can raise it); a test run is always ≤ 1 min |
| Env | 50 entries |
| Name / description | 255 / 2,000 chars |

## Run errors

| `run.error` | Meaning |
| --- | --- |
| `<JS error> [<log>]` | The script threw |
| `Workflow code timed out after <N>ms` | Over the time limit |
| `workflow run was interrupted and is not retried` | The worker died or redeployed mid-run; whatever was written stays |
| `Workflow actor lacks workflow:run:create` | The actor lost the permission — common on old crons |
| `Workflow actor is not active` | The actor was disabled or left |
| `Workflow result is too large` | `main()` returned more than 256 KB |
| `Workflow runner is busy` | Runner overloaded; retry |
| `Workflow run failed` | Infrastructure; a script's own error is always more specific |

Save-time 400s: `Workflow code is required` / `is too large` /
`is invalid: <message> (line N, column M)`, `Module "…" is not available`,
`Invalid cron schedule`, `Invalid cron timezone`, `Manual trigger config must be empty`,
`Webhook trigger config must be empty`.

The server never checks object or field names in code; a wrong one surfaces only at
run time as `UnknownObjectError` / `UnknownFieldError`. That is what `testRun` is for.

## Trigger input

| Trigger | `input` |
| --- | --- |
| `manual` | Whatever the caller passed, `{}` by default |
| `cron` | `{ source: "cron", scheduledAt: "<RFC 3339>" }` |
| `webhook` | `{ source: "webhook", method, query, headers, body, receivedAt }` |

```jsonc
{
  "source": "webhook",
  "method": "POST",
  "query": { "attempt": "1" },
  "headers": { "x-signature": "…" },   // intact, ready to verify
  "body": "{\"amount\":1250.50}",       // the RAW string, not parsed
  "receivedAt": "2026-08-20T09:15:00Z"
}
```

- A webhook delivery is answered `202` with the run id **before** the script runs, so
  it cannot return a meaningful body to the caller.
- Nothing is verified server-side, and every request to a live URL costs a run.
- A draft workflow, an unknown token and a revoked URL all answer `404`.
- A tick from a schedule that no longer exists ends `SUCCESS` with
  `{ skipped: true, reason }` and removes itself.
