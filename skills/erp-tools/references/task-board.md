# The AI task board

Each member has **one board per workspace**, worked only by that member and **Arion**,
the copilot. The member files and moves cards; Arion files what it produced — a
markdown report in the description, tags naming the analysis — and hands it back. It
is not a team tracker: nobody else can open it, not even an owner, and it cannot be
shared.

## Contents

- [Who reaches it](#who-reaches-it)
- [Methods](#methods)
- [Checked before sending](#checked-before-sending)
- [Authorship and assignment](#authorship-and-assignment)
- [Behaviour](#behaviour)
- [Limits](#limits)
- [Filing a report](#filing-a-report)

## Who reaches it

| Credential | Result |
| --- | --- |
| A session — `erp.asUser(token)`, `session(initData).client` | The caller's own board |
| A personal key `erp_uk_…` | The key owner's board — how Arion gets in |
| A service-account key `erp_sk_…` | `TaskBoardError` (`field: "credential"`) before any request; every mini app's own key is one |

There is no RBAC resource or item ACL: owning the board is the check. Every lookup is
scoped to the caller's board, so another member's task is `UnknownTaskError` (404,
never 403). The API cannot tell Arion's key from any other personal key the member
made.

## Methods

```ts
const board = await erp.tasks.board();   // created on first call, id cached; taskCounts covers every status
```

| Method | Notes |
| --- | --- |
| `board()` · `updateBoard({ name?, description? })` | No create or delete — the board exists because the member does |
| `list({ status?, priority?, assignee?, unassigned?, tag?, page?, perPage? })` · `listAll(options)` | `{ tasks, meta }`, newest first; `assignee` is `{ type, id }` |
| `create(spec)` | See below |
| `get(id)` | `TaskDetailDto`, tags and comments included |
| `update(id, { title?, description?, status?, priority?, dueDate?, metadata? })` | |
| `setStatus(id, status)` · `assign(id, assignee \| null)` | `null` unassigns |
| `delete(id, { dryRun? })` | Refuses in development mode |
| `comments(id)` · `comment(id, content \| { content, attachmentUrl?, actor? })` | Oldest first |
| `deleteComment(id, commentId, { dryRun? })` | Refuses in development mode |
| `addTag(id, name \| { name, color? })` · `removeTag(id, name)` | `addTag` returns the whole tag list |

```ts
const task = await erp.tasks.create({
  title: "Hàng chậm luân chuyển — tháng 8/2026",
  description: reportMarkdown,                       // markdown
  status: "review",                                  // todo | in_progress | review | done | archived
  priority: "high",                                  // low | medium | high | urgent
  assignee: { type: "user", id: board.ownerId },
  dueDate: new Date("2026-09-20T17:00:00+07:00"),    // or a full RFC 3339 string
  tags: ["inventory-analysis", { name: "kho", color: "#F59E0B" }],
  metadata: { source: "sql", objects: ["Tồn kho", "Xuất kho"] },
});
```

Types — `TaskBoardDto`, `TaskDto`, `TaskDetailDto`, `TaskCommentDto`, `TaskActor` — and
the enums `TASK_STATUSES` / `TASK_PRIORITIES` are exported from `erp-sdk`.

## Checked before sending

Each throws `TaskBoardError` with `.field` and `.reason`, and sends nothing:

- a service-account key;
- a missing or empty `title`, or any text over its limit;
- a `status`, `priority` or actor type outside its enum;
- a `dueDate` that is neither a `Date` nor a **full** RFC 3339 timestamp —
  `"2026-09-20"` fails;
- a tag color that is not hex (`#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`), an empty tag
  name, more than 50 tags;
- an agent actor or an assignee without an `id`;
- an `update` or `updateBoard` with no change;
- a comment `attachmentUrl` that is not absolute.

The server checks the rest: a `user` assignee must be the board owner (400), and
nobody signs as another member (403).

## Authorship and assignment

| `actor` on `create` / `comment` | Signed by |
| --- | --- |
| Absent | The caller, as `user` |
| `{ type: "agent", id }` | That agent id, **unverified** |
| `{ type: "user", id }` of someone else | Server 403 |

A `user` assignee must be the board owner; an `agent` id is taken as given.

## Behaviour

- **`dueDate` cannot be cleared** once set; omitting it means unchanged.
- **`metadata` replaces the whole object** — read, merge, send it all.
- **Tags** match case-insensitively when added (duplicates collapse, re-adding returns
  the list) but `removeTag` needs the **exact** name, else 404.
- A **user's** comment can be deleted only by its author; an **agent's** by the board's
  owner.
- Creating, editing, moving, assigning, commenting and tagging write for real in
  development mode. `delete` and `deleteComment` refuse there because nothing restores
  them; pass `{ dryRun: false }` once the user agrees.

## Limits

| Item | Limit | Constant |
| --- | --- | --- |
| Board name / description | 255 / 5,000 | `MAX_TASK_BOARD_NAME_LENGTH` / `MAX_TASK_BOARD_DESCRIPTION_LENGTH` |
| Task title | 500 | `MAX_TASK_TITLE_LENGTH` |
| Task description | 100,000 | `MAX_TASK_DESCRIPTION_LENGTH` |
| Comment | 100,000 | `MAX_TASK_COMMENT_LENGTH` |
| Tag name / tags per task | 100 / 50 | `MAX_TASK_TAG_NAME_LENGTH` / `MAX_TASK_TAGS` |
| Attachment URL | 1,024 | `MAX_TASK_ATTACHMENT_URL_LENGTH` |

Lengths count characters; an accented Vietnamese letter is one.

## Filing a report

```ts
const tag = "slow-moving-stock-2026-08";
const { tasks } = await erp.tasks.list({ tag });

if (tasks.length === 0) {
  const task = await erp.tasks.create({
    title: "Hàng chậm luân chuyển — tháng 8/2026",
    description: reportMarkdown,
    status: "review",
    priority: "high",
    tags: [{ name: tag, color: "#F59E0B" }, "inventory-analysis"],
  });
  await erp.tasks.comment(task.id, { content: "File chi tiết đính kèm.", attachmentUrl: documentPageUrl });
}
```

- **Look before filing.** Nothing de-duplicates; a tag naming the run lets the next run
  find this card.
- **`review` is the hand-back column**: done on Arion's side, the member's to judge.
- **The description is the report** — numbers and how they were computed, not only a
  pointer to the conversation.
- **Link documents, don't paste them.** Upload to the drive and link where the member
  can open the file — not a `downloadUrl`, which expires.
- Moving the member's card to `done`, deleting a task or rewriting their description is
  their decision — ask.
