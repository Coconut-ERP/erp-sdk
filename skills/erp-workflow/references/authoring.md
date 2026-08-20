# Writing Workflow Code — Runnable Patterns

Everything below is **workflow file content**: no importing `erp`, no `createMiniApp`, no `process.exit`.
Table/field names are examples — get real names with `npx erp objects show "<Table>"` before writing.

## Default template

```ts
async function main(input) {
  const started = Date.now();
  const done = [];
  const failed = [];

  const orders = await erp.object("Orders");
  const rows = await orders.records()
    .where("Status", "equals", "new")
    .where("Reminded", "equals", false)         // ① pick work by state
    .limit(100)                                  // ② always have a limit
    .fetchAll({ max: 200 });

  for (const row of rows) {
    try {
      await orders.update(row.id, { "Reminded": true });   // ③ mark done immediately
      done.push(row.id);
    } catch (e) {
      failed.push({ id: row.id, error: String(e?.message ?? e) });  // ④ don't throw the whole run
    }
  }

  console.log(`done ${done.length}, errors ${failed.length}`);
  return { done: done.length, failed, durationMs: Date.now() - started };
}
```

The four numbered spots represent four runtime constraints: no retries, 60s timeout, no
reruns (marking done *after* completion means the next run doesn't repeat), and ERROR run logs disappear.

## Idempotent: ba cách, theo thứ tự nên dùng

1. **State flag on the record itself** — `"Sent"`, `"Synced"`, `"ProcessedDate"`. Filter out
   work already done, update immediately after doing it.
2. **Natural key + `unique` constraint** — result records have unique codes (e.g.
   `"ORD-001-2026-08-14"`), duplicates are rejected by the server rather than doubled.
3. **Separate log table** — each run writes one row `{ key, timestamp }`, read it at the start
   of the next run to skip already-done work.

What not to use: counting how many times the run executed, or assuming cron ticks exactly once.
`automaticBackfill: true` even runs missed periods deliberately.

## Batch to avoid timeout

One run is 60 seconds. Long work splits across multiple runs, so cron runs more often:

```ts
const BUDGET_MS = 45_000;                    // leave room for cleanup

async function main() {
  const started = Date.now();
  const items = await erp.object("Queue");
  const rows = await items.records()
    .where("Status", "equals", "pending")
    .orderBy("CreatedDate", "asc")         // real field name — createdAt won't sort
    .fetchAll({ max: 500 });

  let processed = 0;
  for (const row of rows) {
    if (Date.now() - started > BUDGET_MS) break;   // out of time, let the next run finish
    await process(row);
    processed++;
  }
  return { processed, remaining: rows.length - processed };
}
```

Don't `await new Promise(r => setTimeout(r, 60_000))` to wait for something — long waits belong
in cron frequency, not code.

## Money: `decimal.js`

```ts
import Decimal from "decimal";

async function main() {
  const df = (await erp.sql(`
    SELECT "Customer" AS cust, SUM("Total") AS revenue
    FROM "Orders" GROUP BY 1
  `)).toFrame();

  const rows = df.toArray().map((r) => ({
    cust: r.cust,
    revenue: new Decimal(r.revenue).toFixed(0),   // numeric from JSON is a STRING
  }));

  const total = rows.reduce((acc, r) => acc.plus(r.revenue), new Decimal(0));
  return { rows, total: total.toString() };            // return string, not number
}
```

`new Decimal(0.1).plus(0.2).toString()` is `"0.3"`; `0.1 + 0.2` is not. Writing back to ERP also uses strings.

## Validate `input` with zod

Cron, webhooks, and manual triggers send three different input shapes — code must handle all three:

```ts
import { z } from "zod";

const Input = z.union([
  z.object({ source: z.literal("cron"), scheduledAt: z.string() }),
  z.object({
    source: z.literal("webhook"),
    headers: z.record(z.string()),
    body: z.string(),
  }),
  z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
]);

async function main(input) {
  const parsed = Input.safeParse(input ?? {});
  const date = parsed.success && "date" in parsed.data
    ? parsed.data.date
    : moment().format("YYYY-MM-DD");
  …
}
```

## Verify webhook signature

`node:crypto` is not in the registry, but **Web Crypto is global** — no import needed:

```ts
async function verify(rawBody: string, signature: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const sent = Uint8Array.from(
    signature.match(/.{2}/g) ?? [],
    (byte) => Number.parseInt(byte, 16),
  );
  return crypto.subtle.verify("HMAC", key, sent, new TextEncoder().encode(rawBody));
}

async function main(input) {
  if (input.source !== "webhook") return { skipped: "not a webhook" };
  const ok = await verify(input.body, input.headers["x-signature"] ?? "", env.WEBHOOK_SECRET);
  if (!ok) return { rejected: true };
  const event = JSON.parse(input.body);
  …
}
```

Three things make or break verification:

- Sign over **`input.body`**, the raw string. `JSON.parse` then `JSON.stringify` is different bytes
  → signature always fails.
- `crypto.subtle.verify` compares in **constant time**; `===` on hex strings doesn't.
  For string comparison use `crypto.timingSafeEqual`.
- Secret lives in **workflow env** (`env.WEBHOOK_SECRET`), set by the user. Never hardcode:
  code is stored verbatim in the DB.

Bad signature means **`return`, don't `throw`** — a forged request isn't a workflow failure,
and an ERROR run becomes a false alarm in the run history.

Each provider's header is different (`stripe-signature` has a timestamp baked into the payload before signing,
GitHub's `x-hub-signature-256` has a `sha256=` prefix). Read their docs, don't guess.

## Sending outbound

Secrets always come from `process.env`, never in code. **Test-run has no env** → this only
works after saving and the user running `setEnv`.

```ts
import nodemailer from "email";
import TelegramBot from "telegram";
import { WebClient } from "slack";

async function main() {
  const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD, BOT_TOKEN, CHAT_ID } = process.env;
  if (!SMTP_PASSWORD) return { skipped: "missing env SMTP_PASSWORD" };  // report, don't guess

  const mailer = nodemailer.createTransport({
    host: SMTP_HOST, port: 465, secure: true,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
  });
  await mailer.sendMail({ to: "accounting@company.com", subject: "Invoice overdue", text: "…" });

  await new TelegramBot(BOT_TOKEN).sendMessage(CHAT_ID, "…");
  await new WebClient(process.env.SLACK_TOKEN).chat.postMessage({ channel: "#erp", text: "…" });
}
```

⚠️ **Test-run sends for real.** Mail, bot messages, and webhooks don't get rehearsed. When
testing, send to **one** address of the user first, not blast an entire list.

## Calling LLM

```ts
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

async function main() {
  const { object } = await generateObject({
    model: openai("gpt-4o-mini"),          // key from process.env.OPENAI_API_KEY
    schema: z.object({ summary: z.string(), risks: z.array(z.string()) }),
    prompt: "…",
  });
  return object;
}
```

Remember the 60s limit: a long prompt on a slow model can consume the entire run budget.

## HTTP outbound

`axios` is global, `fetch` too. Outbound network is allowed; disk and child processes are not.
Set timeout on external requests, or they'll consume the run's budget:

```ts
const { data } = await axios.get("https://api.partner.com/orders", {
  timeout: 10_000,
  headers: { Authorization: `Bearer ${process.env.PARTNER_TOKEN}` },
});
```

## What to return

`main()` returns **aggregate stats and error lists**, not entire tables — 256KB is the limit,
and whoever reads the run needs to know "what was done", not a data dump.

```ts
return {
  scanned: rows.length,
  updated: done.length,
  skipped: skipped.length,
  errors: failed.slice(0, 20),          // enough to fix, not overflowing
  date: moment().format("YYYY-MM-DD HH:mm"),
};
```

## Things you **can't** write in workflows

| Want to do | Why not | Do this instead |
| --- | --- | --- |
| Read/write files, read CSV/Excel from disk | No `node:fs`, `xlsx`, `csv-parse` | Accept data via `input`, or fetch over HTTP and parse it |
| `npm install` more libraries | Fixed registry | Write it by hand, or call a third-party API with axios |
| Trigger when a record changes | Only `manual`, `cron`, `webhook` | Cron polls by state, or mini app calls `wf.run()` |
| Return meaningful response to webhook caller | Webhook returns `202` immediately, script hasn't run | Use mini app for sync responses (Slack slash commands), not workflows |
| Wait 5 minutes then continue | 60s timeout | Two workflows, or frequent cron + state flag |
| Run with higher permissions than the user | No service account in runs | Grant permissions to the actor, or change who publishes the cron |
| Delete records during test-run | `delete`/`restore`/link calls have no dry run | Prove the rest works, describe the delete part for user review |
