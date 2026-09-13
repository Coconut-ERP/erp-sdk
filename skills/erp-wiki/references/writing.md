# Writing wiki pages

## Contents

- [Page fields](#page-fields)
- [Conventions and taxonomy](#conventions-and-taxonomy)
- [Links](#links)
- [Create or extend](#create-or-extend)
- [Status](#status)
- [Sources](#sources)
- [Lint findings](#lint-findings)
- [The log](#the-log)

## Page fields

| Field | Rule |
| --- | --- |
| `title` | ≤ 255 chars. Names the thing, not a question — except on a `query` page |
| `slug` | Optional; folded from `title` when absent. ≤ 160 chars, immutable |
| `type` | `entity` · `concept` · `comparison` · `query` — how the catalog groups it |
| `summary` | **Required, one line**, ≤ 500 chars — the only thing the catalog shows |
| `body` | Markdown, ≤ 200,000 chars; `[[slug]]` links other pages |
| `tags` | ≤ 20, slugified by the server, expected inside `settings.taxonomy` |
| `confidence` | `high` · `medium` · `low` — how far the workspace should lean on it |
| `contested` | `true` while the workspace disagrees; lint lists these |
| `sourceIds` | ≤ 50 ingested sources the page rests on |

The summary deserves the most care: "Mức tồn tối thiểu theo nhóm hàng và ai được
duyệt vượt mức" says what is inside; "Về chính sách tồn kho" says nothing.

## Conventions and taxonomy

```ts
const { domain, conventions, taxonomy } = await erp.wiki.settings();
await erp.wiki.setSettings({ domain, conventions, taxonomy });   // wiki:manage
```

- `conventions` is the house style; follow it even where your habits differ.
- `domain` frames what belongs in the wiki at all.
- `taxonomy` is the tag vocabulary. Use an existing tag or ask the user to widen it —
  never invent one quietly.

Changing any of them changes how every page is judged: a decision, not a cleanup.

## Links

```md
Nhóm A giữ 30 ngày, theo [[quy-trinh-nhap-kho]] và biên bản họp tháng 8.
```

- `[[…]]` slugifies its contents, so `[[Chính sách tồn kho]]` reaches
  `chinh-sach-ton-kho` — but write the slug itself: a page whose slug has a random
  suffix is unreachable by title.
- Aim for ≥ 2 outbound links. Fewer usually means the page is too small to exist or
  was written without reading the catalog.
- Linking a page that does not exist yet is allowed; it records what to write next,
  and lint lists it as broken until then.
- The detail call returns `outbound` / `inbound`; `WikiPageHandle.brokenLinks`
  (`erp.wiki.handle(slug)`) is the unresolved part of `outbound`.

## Create or extend

Create a page when the subject is **mentioned in ≥ 2 sources** or **central to one**;
otherwise extend the page that covers the area. Both failure modes are common:

- **Over-creation** — every fact gets a page and answers scatter across stubs.
- **Under-creation** — one page grows until every question returns it. When its
  sections never reference each other, split it and link the halves.

Always check first:

```ts
const existing = await erp.wiki.findPage(wikiSlug(title));   // undefined when absent
const near = await erp.wiki.search(title, { limit: 5 });     // same subject, other wording
```

## Status

```
createPage ──► draft ──publish (wiki:manage)──► published
                 ▲                                  │
                 └────────── any update ────────────┘

published ──archive──► archived   (links into it still resolve)
published ──delete───► gone       (links into it break)
```

A draft is a proposal, and writing one is normal agent work. Publishing is the
workspace's decision: draft, then ask. Archive what was superseded; delete only what
should never have existed.

## Sources

```ts
const source = await erp.wiki.ingestSource({
  kind: "article",                 // article | paper | transcript | note
  title: "Biên bản họp kho 08/2026",
  body: text,                      // ≤ 2,000,000 chars
  sourceUrl: "https://…",          // preferred — provenance people can follow
});
await erp.wiki.sources({ page: 1, perPage: 50 });   // bodies omitted
await erp.wiki.source(source.id);                   // body plus the pages built on it
```

Sources are immutable: changed content is a new source, and the page moves its
citation. A claim resting on pasted text with no origin is what `confidence: "low"`
is for.

## Lint findings

```ts
const report = await erp.wiki.lint();
// { totalPages, totalSources, findings: [{ kind, severity, subject, detail }], lintedAt }
```

| Finding | Action |
| --- | --- |
| Broken link | Write the missing page, or fix the slug |
| Orphan page | Link it from a page people reach, or archive it |
| `contested` page | Resolve it with the user; don't pick a side silently |
| Stale page | Re-check against current sources; set `confidence` honestly |
| Thin provenance | Add `sourceIds`, or lower `confidence` |
| Tag outside taxonomy | Use an existing tag, or ask before widening the taxonomy |

Lint needs `wiki:update` because it stamps `lintedAt` and writes to the log. Run it
after a batch of writing.

## The log

```ts
const { entries } = await erp.wiki.log({ page: 1, perPage: 50 });
```

Append-only, newest first: every ingest, edit, publish, archive, delete and lint, with
who did it. Read it when history is the question ("when did we decide this?"), never
instead of the page.
