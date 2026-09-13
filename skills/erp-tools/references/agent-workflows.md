# Agent workflows

An agent workflow stores a **prompt**; each run hands it to the ERP copilot in a fresh
hidden conversation. Triggers, draft/publish/version, the webhook URL and run history
work as for scripts (`workflows.md`); only what a run does differs.

## Contents

- [Script or agent](#script-or-agent)
- [What an agent workflow lacks](#what-an-agent-workflow-lacks)
- [Who the agent acts as](#who-the-agent-acts-as)
- [Writing the prompt](#writing-the-prompt)
- [Reading what happened](#reading-what-happened)
- [Errors](#errors)

```ts
const wf = await erp.workflows.create({
  name: "Tổng hợp đơn hôm qua",
  kind: "agent",
  prompt: `Tổng hợp đơn hàng của ngày hôm qua trong object "Đơn hàng":
đếm số đơn, cộng "Tổng tiền", rồi tạo một bản ghi trong "Báo cáo ngày".
Nếu hôm qua không có đơn nào thì vẫn tạo bản ghi với số 0.
Nếu đã có bản ghi cho ngày đó rồi thì dừng, đừng tạo bản ghi thứ hai.`,
  trigger: { type: "cron", config: { schedule: "0 0 8 * * *", timezone: "Asia/Ho_Chi_Minh" } },
});
await wf.publish();
```

## Script or agent

Pick a **script** when the work is decided: the same fields, arithmetic and recipients
every time. Scripts are exact, fast, cheap and rehearsable, hold secrets and call other
APIs. Anything that runs every few minutes is a script.

Pick an **agent** when writing the script is the expensive part: the task needs
judgement ("summarise what went wrong yesterday"), reads a payload nobody pinned down,
or is a paragraph of instructions that would be hundreds of brittle lines. The agent
already knows the workspace schema — but it re-derives everything each run, and a run
is minutes to an hour of copilot work.

For a strict computation plus a judgement call, write the computation as a script
workflow and tell the agent to run it.

## What an agent workflow lacks

| Missing | Consequence |
| --- | --- |
| Env | `setEnv` throws `WorkflowDefinitionError`; nothing could read a secret |
| Shared variables | They answer only a script run's token; keep a checkpoint in a record or a wiki page |
| `check` / `testRun` | The handle refuses both. **Running it is the only test, and it writes real data** |
| A result in the run | The run ends where the conversation starts |
| Cancel through the workflow | Stop the turn in the copilot (`POST /ai/turns/{turnId}/cancel`) |
| Overlap protection | A 5-minute cron over a 20-minute agent opens parallel conversations |

## Who the agent acts as

A `manual` run acts as whoever started it; `cron` and `webhook` runs act as the
publisher. The agent works in that person's sandbox with their personal key, so their
permissions, row scopes and ACLs bound it, and the conversation is theirs:

- A cron agent's hidden conversation is visible **only to its publisher** — not to
  admins, not to a mini app's service account.
- Publishing or running needs `ai:create` on top of `workflow:run:create`, checked at
  publish, at every manual run, at every cron tick and inside the run. Someone who
  loses copilot access stops their crons.

## Writing the prompt

≤ 8,000 characters, counted by code point (`workflowPromptChars`;
`assertWorkflowPrompt` throws before sending). A long procedure belongs in a wiki page
the prompt names.

Trigger input — a cron tick's `scheduledAt`, a webhook's whole delivery — is appended
to the prompt under a heading telling the agent to treat it as data, never as
instructions; that framing is the defence against strangers posting to the URL. So
**write no placeholders** (`{{payload}}`, `$input`); describe the payload instead:
*"the Trigger payload below is the partner's webhook body; read `orderId` from it"*.

An unattended prompt needs:

- **Exact names** of objects and fields, as the workspace spells them.
- **The empty case** — "if there are no orders…", or a quiet day looks broken.
- **Idempotency** — "if a record for that date exists, stop"; nothing prevents overlap.
- **A stopping rule** — "if unsure, don't guess: note it and stop".
- **Where the result goes** — a record, a wiki page, a task, a message via a script
  workflow. What stays in the conversation only the publisher will read.

## Reading what happened

```ts
const finished = await wf.runAndWait();
const handed = agentRunResult(finished);           // { conversationId, turnId }

const conversation = await erp.conversations.get(handed.conversationId);
conversation.activeTurn;                           // set while the agent works
conversation.messages.at(-1)?.content;             // the answer, once activeTurn is gone
```

The run reaches `SUCCESS` within seconds. **`SUCCESS` means handed over**, not done or
done right — report it that way. Hidden conversations are hidden from listings only:
`erp.conversations.list({ visibility: "hidden" })` shows them, and `get(id)` reads them.

Webhook `/test` does not rehearse an agent: the copilot is not in development mode and
writes for real. Warn the user before using it.

## Errors

| HTTP | Message | Cause |
| --- | --- | --- |
| 400 | `Agent workflows carry a prompt, not code` | `code` sent with `kind: "agent"` |
| 400 | `Code workflows carry code, not a prompt` | `prompt` sent with `kind: "code"` |
| 400 | `Agent workflow prompt is required` / `is too large` | Empty, or over 8,000 characters |
| 400 / 409 | `Agent workflows run no script, so they have no env` | Env at create, or `PUT /env` later |
| 403 | `Workflow actor lacks ai:create` | The actor cannot use the copilot |
| 503 | `Arion is not configured on this deployment` | No copilot on this deployment |

Switching an existing workflow to `agent` drops its code and env; send the prompt in
the same call — `wf.update({ kind: "agent", prompt })` — or it throws
`WorkflowDefinitionError`.
