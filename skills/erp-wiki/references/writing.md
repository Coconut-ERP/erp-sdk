# Writing Wiki Pages

## Anatomy of a page

| Field | Rule |
| --- | --- |
| `title` | ≤ 255 chars. Names the thing, not the question ("Chính sách tồn kho", not "Tồn kho thế nào?") — except on a `query` page, where the question *is* the thing |
| `slug` | Optional; the server folds `title` when absent. ≤ 160 chars, immutable afterwards |
| `type` | `entity` · `concept` · `comparison` · `query` — decides how the catalog groups it |
| `summary` | **Required, one line**, ≤ 500 chars. The only thing the catalog shows |
| `body` | Markdown, ≤ 200 000 chars. `[[slug]]` links other pages |
| `tags` | ≤ 20, slugified server-side, expected to sit inside `settings.taxonomy` |
| `confidence` | `high` · `medium` · `low` — how much the workspace should lean on this |
| `contested` | `true` when the workspace does not agree yet. Lint surfaces these |
| `sourceIds` | ≤ 50 ingested sources this page rests on |

The `summary` earns the most care: someone deciding whether to open the page reads only
that line. "Mức tồn tối thiểu theo nhóm hàng và ai được duyệt vượt mức" says what is
inside; "Về chính sách tồn kho" says nothing.

## Write to the conventions

```ts
const { domain, conventions, taxonomy } = await erp.wiki.settings();
```

`conventions` is the workspace's house style — read it before drafting, and follow it
even when your own habits differ. It is what keeps a wiki written by several people and
several agents reading like one document. `domain` frames what belongs in the wiki at
all; a page outside it is usually a note that belongs somewhere else.

`taxonomy` is the allowed tag vocabulary. A tag outside it is a lint finding, so either
use an existing tag or ask the user to widen the taxonomy — never quietly invent one.

Changing any of the three takes `wiki:manage` and changes how **every** page is judged.
It is a decision, not a cleanup task.

## Links are the structure

A page's value is largely in what it connects to.

```md
Nhóm A giữ 30 ngày, theo [[quy-trinh-nhap-kho]] và biên bản họp tháng 8.
So sánh giữa hai kho: [[kho-binh-duong-vs-long-an]].
```

- `[[slug]]` resolves by slugifying what is inside the brackets, so `[[Chính sách tồn
  kho]]` reaches `chinh-sach-ton-kho` — but writing the slug directly is safer, because a
  page whose slug carries a random suffix is unreachable by title.
- **Aim for ≥ 2 outbound links.** Fewer usually means the page is either too small to
  exist or was written without reading the catalog.
- Linking a page that does not exist yet is allowed and sometimes correct: it records
  what should be written next. Lint will list it as broken until it is.
- `page.outbound` / `page.inbound` come back on the detail call;
  `handle.brokenLinks` is the unresolved half of the outbound list.

## When to create versus extend

Create a page when the subject is **mentioned in ≥ 2 sources**, or **central to one**.
Otherwise add a paragraph to the page that already covers the area. Two failure modes,
both common:

- **Over-creation.** Every fact gets a page, the catalog becomes a list nobody reads,
  and answers scatter across ten stubs.
- **Under-creation.** One "Kho" page grows to 3 000 lines and every question about
  anything warehouse-shaped returns it. When a page needs sections that never reference
  each other, split it and link the halves.

Check for an existing page first — always:

```ts
const existing = await erp.wiki.findPage(wikiSlug(title));   // undefined when absent
const near = await erp.wiki.search(title, { limit: 5 });     // same subject, other wording
```

## Status, and who decides

```
createPage ──► draft ──publish (wiki:manage)──► published
                 ▲                                  │
                 └────────── any update ────────────┘

published ──archive──► archived        (links into it still resolve)
published ──delete───► gone            (links into it become broken)
```

- A `draft` is a proposal. Writing one is a normal task for an agent.
- **Publishing is a decision the workspace makes**, not one an agent makes on its own —
  it says the workspace stands behind the page. Draft, then ask.
- `archive` retires a page that has been superseded; `delete` is for a page that should
  never have existed. Deleting to "clean up" leaves broken links behind.

## Sources

```ts
const source = await erp.wiki.ingestSource({
  kind: "article" | "paper" | "transcript" | "note",
  title: "Biên bản họp kho 08/2026",
  body: text,                     // ≤ 2 000 000 chars
  sourceUrl: "https://…",         // optional but preferred — provenance people can follow
});
await erp.wiki.sources({ page: 1, perPage: 50 });   // bodies omitted from the list
await erp.wiki.source(source.id);                   // body + pages compiled from it
```

Sources are **immutable**. Content that changed is a new source, and the page moves its
citation — that is what keeps an old claim checkable against what was actually read.

Prefer a source with a `sourceUrl` over pasted text with no origin; a claim whose
provenance is "somebody pasted this once" is what `confidence: "low"` is for.

## Lint findings and what each one means

```ts
const report = await erp.wiki.lint();
// { totalPages, totalSources, findings: [{ kind, severity, subject, detail }], lintedAt }
```

| Finding | What to do |
| --- | --- |
| Broken link | Write the missing page, or fix the slug in the body |
| Orphan page | Link it from a page people actually reach, or archive it |
| `contested` page | Resolve the disagreement with the user; don't silently pick a side |
| Stale page | Re-check it against current sources; update `confidence` honestly |
| Thin provenance | Add `sourceIds`, or lower `confidence` to match what is actually known |
| Tag outside taxonomy | Use an existing tag, or ask before widening the taxonomy |

Lint takes `wiki:update`, not `read`: it stamps `lintedAt` and appends to the log. Run
it after a batch of writing, and treat the findings as the next work item rather than a
number to report.

## The log

```ts
const { entries } = await erp.wiki.log({ page: 1, perPage: 50 });
```

Append-only, newest first: every ingest, edit, publish, archive, delete and lint, with
who did it. Read it when a page's history is the question ("when did we decide this?"),
and never as a substitute for the page itself.
