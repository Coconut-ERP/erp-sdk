# The AI Task Board — a Member's Kanban, Shared with Arion

Every member has **exactly one board per workspace**, and only two parties ever
work on it: that member and **Arion**, the copilot. The member files and moves
cards; Arion files what it produced as a task — a markdown report in the
description, tags saying which analysis it came from — and hands it back.

It is not a team tracker. Nobody else can open the board, not even a workspace
owner, and there is no way to share it.

## Who reaches it

| Credential | Result |
| --- | --- |
| A logged-in session (`erp.asUser(token)`, `session(initData).client`) | the caller's own board |
| A personal API key `erp_uk_…` | the key owner's board — this is how Arion gets in: its sandbox holds a key minted for the member |
| A service account key `erp_sk_…` | **`TaskBoardError`** (`field: "credential"`) before any request — the server would answer 403, because no member stands behind the key. Every mini app's own key is one of these |

There is no RBAC resource and no item ACL: being the owner is the whole check.
Every lookup is scoped to the caller's board, so a task on another member's board
is **`UnknownTaskError`** — the server answers 404, never 403, and the id reveals
nothing.

Any personal key the member creates reaches the board too; the API cannot tell
Arion's key from another of theirs.

## `erp.tasks`

```ts
import { createMiniApp } from "erp-sdk";

const erp = await createMiniApp({
  baseUrl: process.env.ERP_BASE_URL,
  apiKey: process.env.ERP_API_KEY,          // an erp_uk_ personal key
});

const board = await erp.tasks.board();
board.taskCounts;                            // every status present, zero included
```

| Method | Endpoint | Notes |
| --- | --- | --- |
| `board()` | `GET /boards`, then `GET /boards/:id` | The board is **created on first call**; its id is cached on the client |
| `updateBoard({ name?, description? })` | `PATCH /boards/:id` | There is no create or delete — the board exists because the member does |
| `list({ status?, priority?, assignee?, unassigned?, tag?, page?, perPage? })` | `GET /boards/:id/tasks` | `{ tasks, meta }`, newest first. `assignee` is `{ type, id }` |
| `listAll(options)` | same, every page | Walks `meta.totalPages` |
| `create(spec)` | `POST /boards/:id/tasks` | See below |
| `get(id)` | `GET /tasks/:id` | `TaskDetailDto` — tags and comments embedded |
| `update(id, changes)` | `PATCH /tasks/:id` | `title`, `description`, `status`, `priority`, `dueDate`, `metadata` |
| `setStatus(id, status)` | `PATCH /tasks/:id/status` | |
| `assign(id, assignee \| null)` | `PATCH /tasks/:id/assign` | `null` unassigns |
| `delete(id, { dryRun? })` | `DELETE /tasks/:id` | Refuses in development mode |
| `comments(id)` | `GET /tasks/:id/comments` | Oldest first |
| `comment(id, content \| { content, attachmentUrl?, actor? })` | `POST /tasks/:id/comments` | |
| `deleteComment(id, commentId, { dryRun? })` | `DELETE /tasks/:id/comments/:commentId` | Refuses in development mode |
| `addTag(id, name \| { name, color? })` | `POST /tasks/:id/tags` | Returns the task's whole tag list |
| `removeTag(id, name)` | `DELETE /tasks/:id/tags/:name` | Name is URL-encoded for you |

```ts
const task = await erp.tasks.create({
  title: "Hàng chậm luân chuyển — tháng 8/2026",
  description: reportMarkdown,                       // markdown
  status: "review",                                  // TASK_STATUSES
  priority: "high",                                  // TASK_PRIORITIES
  assignee: { type: "user", id: board.ownerId },
  dueDate: new Date("2026-09-20T17:00:00+07:00"),    // or a full RFC 3339 string
  tags: ["inventory-analysis", { name: "kho", color: "#F59E0B" }],
  metadata: { source: "sql", objects: ["Tồn kho", "Xuất kho"] },
});
```

## What the SDK checks before sending

Each of these throws `TaskBoardError` with `.field` and `.reason`, and sends
nothing:

- a service account key (`credential`);
- `title` missing or empty, or any text past its limit;
- `status`, `priority` or an actor type outside its enum;
- `dueDate` that is not a `Date` or a **full** RFC 3339 timestamp —
  `"2026-09-20"` fails here instead of as a server 400;
- a tag color that is not hex (`#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`), an empty
  tag name, more than 50 tags;
- `actor: { type: "agent" }` without an `id`, an assignee without an `id`;
- an `update` or `updateBoard` carrying no change;
- a comment `attachmentUrl` that is not an absolute URL.

What it cannot check is left to the server: a `user` assignee who is not the
board owner (400), signing as another member (403).

## Shapes

```ts
interface TaskActor { id: string; type: "user" | "agent" }

interface TaskBoardDto {
  id: string; workspaceId: string; ownerId?: string;
  name: string; description: string;
  createdBy: TaskActor; createdAt: string; updatedAt: string;
}
interface TaskBoardDetailDto extends TaskBoardDto {
  taskCounts: Partial<Record<TaskStatus, number>>;
}

interface TaskDto {
  id: string; boardId: string; workspaceId: string;
  title: string; description: string;
  status: "todo" | "in_progress" | "review" | "done" | "archived";
  priority: "low" | "medium" | "high" | "urgent";
  assignedTo: TaskActor | null;
  createdBy: TaskActor;
  dueDate?: string;
  tags: { id: string; name: string; color: string }[];
  metadata: Record<string, unknown>;
  createdAt: string; updatedAt: string;
}
interface TaskDetailDto extends TaskDto { comments: TaskCommentDto[] }

interface TaskCommentDto {
  id: string; taskId: string; author: TaskActor;
  content: string; attachmentUrl?: string;
  createdAt: string; updatedAt: string;
}
```

## Authorship and assignment

`create` and `comment` take an optional `actor`, deciding whose name goes on the
row:

| `actor` | Row is signed by |
| --- | --- |
| absent | the caller, as `user` |
| `{ type: "agent", id }` | that agent id, **as given — nothing verifies it** |
| `{ type: "user", id }` with someone else's id | server 403 — a member never signs another member's name |

A `user` assignee **must be the board owner**. An `agent` id is accepted as given.

## Behaviour worth knowing

- **`dueDate` cannot be cleared.** Leaving it out of `update` means "unchanged",
  and there is no way to send a clear.
- **`metadata` replaces the whole object** when sent. Read the task, merge, send
  it all back.
- **Tags are case-insensitive on the way in, case-sensitive on the way out.**
  Duplicates in a create collapse; adding a tag the task already has returns the
  current list; `removeTag` matches the name **exactly**, else the server 404s.
- Two concurrent adds of the same tag name: one lands, the other gets a 500 from
  the unique index.
- A **user's** comment can be deleted only by its author (403 otherwise); an
  **agent's** comment by any member — on a personal board, the owner.
- **No dry run.** Creating, editing, moving, assigning, commenting and tagging
  write for real in development mode. `delete` and `deleteComment` refuse there
  with `DryRunUnsupportedError`, because the API has no way to restore either;
  pass `{ dryRun: false }` once the user has agreed.

## Limits

| Item | Limit | Constant |
| --- | --- | --- |
| Board name / description | 255 / 5 000 | `MAX_TASK_BOARD_NAME_LENGTH` / `MAX_TASK_BOARD_DESCRIPTION_LENGTH` |
| Task title | 500 | `MAX_TASK_TITLE_LENGTH` |
| Task description | 100 000 | `MAX_TASK_DESCRIPTION_LENGTH` |
| Comment content | 100 000 | `MAX_TASK_COMMENT_LENGTH` |
| Tag name / tags per task | 100 / 50 | `MAX_TASK_TAG_NAME_LENGTH` / `MAX_TASK_TAGS` |
| Attachment URL | 1 024 | `MAX_TASK_ATTACHMENT_URL_LENGTH` |

Lengths count characters, so a Vietnamese letter with its accent is one.

## Filing a report as a task

The board exists so an analysis ends somewhere the member will see it:

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
    metadata: { source: "sql", objects: ["Tồn kho", "Xuất kho"] },
  });
  await erp.tasks.comment(task.id, {
    content: "File chi tiết đính kèm.",
    attachmentUrl: downloadPageUrl,
  });
}
```

- **Look before filing.** Nothing de-duplicates tasks; a tag naming the run makes
  a second run find the first card instead of adding another.
- **`review` is the hand-back column.** It says "done on my side, yours to judge"
  without claiming the member agreed.
- **The description is the report.** Markdown renders; put the numbers and how they
  were computed there, not only in the conversation.
- **Link a document instead of pasting it.** Upload to the drive
  (`references/files.md`) and put a link to where the member can open it in a
  comment's `attachmentUrl` — not `files.downloadUrl`, which expires.
- Moving a member's own card to `done`, deleting a task, or rewriting their
  description is their decision — **ask first**.

## Pitfalls

| Symptom | Cause |
| --- | --- |
| `TaskBoardError` on `credential` | The client runs on a service account key; use a member's session or `erp_uk_` key |
| `UnknownTaskError` for a task id you know exists | It is on another member's board — scoping hides it |
| `TaskBoardError` on `dueDate` | A bare date; pass a `Date` or a full timestamp |
| Server 400 assigning to a colleague | A user assignee must be the board owner |
| A metadata key disappeared | `update` with `metadata` replaced the whole object |
| Server 404 removing a tag you can see | Case differs — removal matches the exact name |
| `DryRunUnsupportedError` deleting | `ERP_ENV=development`; deletes cannot be undone |
| The same report appears twice | Nothing de-duplicates; `list({ tag })` first |
