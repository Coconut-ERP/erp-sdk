# Agent workflows — automation written as a prompt

A workflow has a `kind`. `code` is the original one: a stored script the runner
executes. `agent` is the other: a stored **prompt** that a run hands to the ERP
copilot in a fresh hidden conversation.

Everything around it is shared — the same triggers (`manual`, `cron`,
`webhook`), the same draft/publish/version lifecycle, the same webhook URL, the
same run history. Only what one run *does* is different.

```ts
const wf = await erp.workflows.create({
  name: "Tổng hợp đơn hôm qua",
  kind: "agent",
  prompt: `Tổng hợp đơn hàng của ngày hôm qua trong object "Đơn hàng":
đếm số đơn, cộng "Tổng tiền", rồi tạo một bản ghi trong "Báo cáo ngày".
Nếu hôm qua không có đơn nào thì vẫn tạo bản ghi với số 0.
Nếu đã có bản ghi cho ngày đó rồi thì dừng, đừng tạo bản ghi thứ hai.`,
  trigger: {
    type: "cron",
    config: { schedule: "0 0 8 * * *", timezone: "Asia/Ho_Chi_Minh" },
  },
});
await wf.publish();
```

## Which kind to write

Pick **script** when the work is already decided: the same fields, the same
arithmetic, the same recipients every time. Scripts are exact, fast, cheap,
rehearsable (`check` / `testRun`), and they can hold secrets and call other
APIs. Anything that runs every few minutes has to be a script.

Pick **agent** when writing the script is the expensive part: the task needs
judgment ("summarise what went wrong yesterday"), or it reads a payload whose
shape nobody pinned down, or it is one paragraph of instructions that would be
three hundred lines of brittle code. The agent already knows the workspace
schema, so it does not need the object and field names hard-coded — but it
also re-derives everything on every run, and one run is minutes to an hour of
copilot work.

When the two mix — a strict computation plus a judgement call — write the
computation as a script workflow and tell the agent to run it.

## What an agent workflow does not have

| Missing | Why |
| --- | --- |
| `env` | Nothing of it executes, so a stored secret would be one nothing can read. `setEnv` throws `WorkflowDefinitionError` before the 409 |
| Shared variables (`erp.variables`) | Those answer a token carrying the workflow's id, which only a script run has. An agent has the actor's personal key, so a checkpoint has to live in a record or a wiki page |
| `check` / `testRun` | There is nothing to transpile and nothing to rehearse. The handle throws rather than sending the call. **The only way to try an agent workflow is to run it, and it writes real data** |
| A result in the run | The run ends where the conversation starts |
| Cancellation through the workflow | Stop it in copilot — `POST /ai/turns/{turnId}/cancel` |
| Overlap protection | A cron every 5 minutes over a 20-minute agent just opens more conversations in parallel. Leave room for the work |

## Who the agent acts as

The same actor rules as a script: `manual` is the person who pressed run,
`cron` and `webhook` are the person who published it. The agent then works in
**that person's** sandbox with their personal key, so their permissions, row
scopes and ACLs bound everything it does, and the conversation belongs to them.

Two consequences worth telling the user about:

- The hidden conversation of a cron agent workflow is visible **only to whoever
  published it** — not to workspace admins, not to a mini app's service account.
- Running or publishing one needs `ai:create` on top of `workflow:run:create`.
  Without it: 403 `Workflow actor lacks ai:create`, checked at publish, at
  every manual run, at every cron tick, and again inside the run. Someone who
  loses copilot access has their cron stop. A deployment with no copilot at all
  answers 503 `Arion is not configured on this deployment`.

## Trigger data reaches the prompt on its own

A run with input — the `scheduledAt` of a cron tick, the whole delivery of a
webhook — sends the prompt with the payload appended under a heading that tells
the agent to treat it as data and never as instructions. That framing is the
defence against a stranger posting instructions to a webhook URL.

So **do not write placeholders** (`{{payload}}`, `$input`) into the prompt.
Write about the payload instead: *"phần Trigger payload bên dưới là body của
webhook đối tác gửi; đọc `orderId` trong đó"*.

## Writing the prompt

The cap is **8 000 characters**. `workflowPromptChars(prompt)` counts them by
code point, so a Vietnamese character with a dấu counts as one;
`assertWorkflowPrompt` throws before the round trip. A long standard operating
procedure belongs in a wiki page, with the prompt saying which page to read.

A prompt that runs unattended at 3am is not a chat message. Give it:

- **The names it will use**, exactly as the workspace spells them. The agent
  can look them up, but a wrong guess it never sees corrected costs a run.
- **The empty case.** "Nếu không có đơn nào" — otherwise a quiet day looks like
  a broken run.
- **Idempotency.** Nothing stops two runs overlapping, and there is no retry to
  protect against. Say "nếu đã có bản ghi cho ngày đó thì dừng".
- **A stopping rule.** "Nếu không chắc, đừng đoán — ghi lại và dừng." An agent
  that guesses at 3am is worse than one that does nothing.
- **Where the answer goes.** A record, a wiki page, a Telegram message through
  a script workflow. What it only says in the conversation, only the publisher
  will ever read.

## Reading what happened

```ts
const started = await wf.run();
const finished = await wf.waitForRun(started.id);
const handed = agentRunResult(finished);

const conversation = await erp.conversations.get(handed.conversationId);
conversation.activeTurn;
conversation.messages.at(-1)?.content;
```

The run goes `ENQUEUED` then `SUCCESS` within a second or two, and `handed` is
`{ conversationId, turnId }`. `activeTurn` is set for as long as the agent is
still working; once it is gone, the last message is the answer.

`SUCCESS` on an agent run means **the work was handed over**, not that it was
done or done right. Say it that way in any report: *đã khởi tạo hội thoại*.

The conversations an agent workflow opens are `hidden`, which is a listing
default and not a permission — they read normally by id:

```ts
await erp.conversations.list({ visibility: "hidden" });
```

`visibility` takes `visible` (the default), `hidden` or `all`.

## Webhook `/test` is not a rehearsal here

`POST <webhookUrl>/test` runs the **draft**, which is half of what a test
should be. The other half is missing: development mode is a flag on the runner,
and an agent never goes near the runner, so the copilot runs for real and
writes real data. Warn the user before pressing it.

## Errors

| HTTP | Message | Cause |
| --- | --- | --- |
| 400 | `Agent workflows carry a prompt, not code` | `code` sent with `kind: "agent"` |
| 400 | `Code workflows carry code, not a prompt` | `prompt` sent with `kind: "code"` |
| 400 | `Agent workflow prompt is required` | Empty prompt |
| 400 | `Agent workflow prompt is too large` | Over 8 000 characters |
| 400 / 409 | `Agent workflows run no script, so they have no env` | Env at create, or `PUT /env` afterwards |
| 403 | `Workflow actor lacks ai:create` | The actor cannot use copilot |
| 503 | `Arion is not configured on this deployment` | No copilot on this deployment — the whole feature is unavailable |

Switching an existing workflow between kinds **drops what it held** — the code
or the prompt, and the env as well when moving to `agent`. Send the
replacement in the same call, which is what `update` insists on:

```ts
await wf.update({ kind: "agent", prompt: "…" });
```

Without the prompt in that same call it throws `WorkflowDefinitionError`.
