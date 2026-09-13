# Workflow code patterns

Everything below is the content of a workflow's `code`: `erp`, `env` and friends are
globals (`workflow-runtime.md`), so there is no `createMiniApp` and no
`process.exit`. Field names are examples — read the real ones with
`npx erp objects show "<Table>"`.

## Contents

- [Default shape](#default-shape)
- [Idempotency](#idempotency)
- [Staying under the time limit](#staying-under-the-time-limit)
- [Money](#money)
- [Validating input](#validating-input)
- [Verifying a webhook signature](#verifying-a-webhook-signature)
- [Sending messages](#sending-messages)
- [Calling an LLM](#calling-an-llm)
- [Outbound HTTP](#outbound-http)
- [Files and spreadsheets](#files-and-spreadsheets)
- [What a workflow cannot do](#what-a-workflow-cannot-do)

## Default shape

```ts
async function main(input) {
  const started = Date.now();
  const done = [];
  const failed = [];

  const orders = await erp.object("Orders");
  const rows = await orders.records()
    .where("Status", "equals", "new")
    .where("Reminded", "equals", false)          // pick work by state
    .limit(100)
    .fetchAll({ max: 200 });                     // always bounded

  for (const row of rows) {
    try {
      await sendReminder(row);
      await orders.update(row.id, { Reminded: true });   // mark each item as it is done
      done.push(row.id);
    } catch (e) {
      failed.push({ id: row.id, error: String(e?.message ?? e) });   // one failure doesn't end the run
    }
  }

  return { done: done.length, failed: failed.slice(0, 20), durationMs: Date.now() - started };
}
```

It answers the runtime's constraints: no retries, a 60-second limit, runs that may
overlap or repeat, and logs that vanish when a run ends in `ERROR`.

## Idempotency

In order of preference:

1. **A state field on the record** — `Sent`, `Synced`, `Processed Date`. Filter out
   finished work; update right after doing it.
2. **A natural key with a `unique` field** — e.g. `ORD-001-2026-08-14`, so the server
   rejects a duplicate instead of storing it twice.
3. **A log table** — one row per unit of work, read at the start of the next run.

Never count runs or assume a cron fires exactly once; `automaticBackfill` replays
missed ticks on purpose.

## Staying under the time limit

```ts
const BUDGET_MS = 45_000;   // room to return

async function main() {
  const started = Date.now();
  const queue = await erp.object("Queue");
  const rows = await queue.records()
    .where("Status", "equals", "pending")
    .orderBy("Queued At", "asc")              // a real field — createdAt cannot be sorted
    .fetchAll({ max: 500 });

  let processed = 0;
  for (const row of rows) {
    if (Date.now() - started > BUDGET_MS) break;
    await handleRow(row);                     // your per-row work; it should mark the row done
    processed++;
  }
  return { processed, remaining: rows.length - processed };
}
```

Long work spreads over several runs with a more frequent cron. Never wait inside a run
(`setTimeout` for minutes); waiting belongs in the schedule.

## Money

```ts
import Decimal from "decimal";

async function main() {
  const { rows } = await erp.sql(`SELECT "Customer" AS cust, SUM("Total") AS revenue FROM "Orders" GROUP BY 1`);
  const total = rows.reduce((acc, r) => acc.plus(r.revenue), new Decimal(0));   // numeric arrives as a string
  return { customers: rows.length, total: total.toFixed(0) };                   // return strings, not floats
}
```

Write amounts back to the ERP as strings too.

## Validating input

Manual, cron and webhook runs pass different shapes; accept all that apply:

```ts
import { z } from "zod";

const Input = z.union([
  z.object({ source: z.literal("cron"), scheduledAt: z.string() }),
  z.object({ source: z.literal("webhook"), headers: z.record(z.string()), body: z.string() }),
  z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
]);

async function main(input) {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { rejected: parsed.error.issues.slice(0, 5) };
  const date = "date" in parsed.data ? parsed.data.date : moment().format("YYYY-MM-DD");
  …
}
```

## Verifying a webhook signature

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function verified(rawBody, signatureHex, secret) {
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const sent = Buffer.from(signatureHex, "hex");
  return sent.length === expected.length && timingSafeEqual(sent, expected);
}

async function main(input) {
  if (input.source !== "webhook") return { skipped: "not a webhook" };
  if (!env.WEBHOOK_SECRET) return { skipped: "missing env WEBHOOK_SECRET" };
  if (!verified(input.body, input.headers["x-signature"] ?? "", env.WEBHOOK_SECRET)) {
    return { rejected: true };
  }
  const event = JSON.parse(input.body);
  …
}
```

- Sign over **`input.body`**, the raw string. Parsing and re-serialising changes the
  bytes and the signature never matches.
- Compare with `timingSafeEqual`, never `===`.
- The secret lives in the workflow's env, set by the user — code is stored verbatim.
- A bad signature **returns**; throwing would record a forged request as a failed run.
- Providers differ: Stripe signs a timestamp with the payload, GitHub prefixes
  `sha256=`. Follow their documentation.

## Sending messages

```ts
import nodemailer from "email";
import TelegramBot from "telegram";
import { WebClient } from "slack";

async function main() {
  const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD, BOT_TOKEN, CHAT_ID, SLACK_TOKEN } = env;
  if (!SMTP_PASSWORD) return { skipped: "missing env SMTP_PASSWORD" };

  const mailer = nodemailer.createTransport({
    host: SMTP_HOST, port: 465, secure: true,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
  });
  await mailer.sendMail({ to: "accounting@company.com", subject: "Invoice overdue", text: "…" });
  await new TelegramBot(BOT_TOKEN).sendMessage(CHAT_ID, "…");
  await new WebClient(SLACK_TOKEN).chat.postMessage({ channel: "#erp", text: "…" });
}
```

A test run gets the env only when given the workflow's id, and **sends for real**:
point it at one recipient of the user's choosing first.

## Calling an LLM

```ts
import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

async function main() {
  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
  const { object } = await generateObject({
    model: openai("gpt-4o-mini"),
    schema: z.object({ summary: z.string(), risks: z.array(z.string()) }),
    prompt: "…",
  });
  return object;
}
```

A slow model on a long prompt can spend the whole 60 seconds. For judgement that
takes minutes, use an agent workflow instead (`agent-workflows.md`).

## Outbound HTTP

`axios` and `fetch` are globals. Always set a timeout, or one slow partner eats the
run:

```ts
const { data } = await axios.get("https://api.partner.com/orders", {
  timeout: 10_000,
  headers: { Authorization: `Bearer ${env.PARTNER_TOKEN}` },
});
```

## Files and spreadsheets

There is no disk. Bytes come from the drive, from HTTP, or from `input`, and parse in
memory:

```ts
import ExcelJS from "exceljs";
import Papa from "papaparse";

async function main() {
  const { files } = await erp.files.list({ folderId: env.IMPORT_FOLDER_ID, search: ".csv" });
  const csv = await erp.files.downloadText(files[0].id);
  const { data } = Papa.parse(csv, { header: true, skipEmptyLines: true });

  const book = new ExcelJS.Workbook();
  book.addWorksheet("Summary").addRows(data.slice(0, 100).map(Object.values));
  const buffer = await book.xlsx.writeBuffer();
  await erp.files.upload({ folderId: env.EXPORT_FOLDER_ID, name: "summary.xlsx", content: new Uint8Array(buffer) });
  return { rows: data.length };
}
```

## What a workflow cannot do

| Want | Why not | Instead |
| --- | --- | --- |
| Read or write local files | No `node:fs`, no disk | The drive (`erp.files`), HTTP, or `input` |
| Install another package | Fixed registry | Plain code, or the partner's HTTP API |
| Fire when a record changes | Triggers are manual, cron, webhook | Poll by state on a cron, or call `wf.run()` from an app |
| Answer a webhook caller with data | The delivery gets `202` before the script runs | A mini app endpoint |
| Wait five minutes and continue | 60-second limit | Two workflows, or a frequent cron with a state field |
| Run with more rights than a person | Runs act as their actor | Grant the actor, or change who publishes |
| Delete records inside a test run | `delete`, `restore` and link calls have no dry run | Prove the rest; describe the delete for the user to review |
