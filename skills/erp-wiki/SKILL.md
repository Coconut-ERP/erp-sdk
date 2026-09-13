---
name: erp-wiki
description: Writes, maintains and retrieves from the Coconut ERP workspace wiki with erp-sdk — pages (entity, concept, comparison, query) addressed by slug, immutable sources, `[[slug]]` links, draft/publish/archive, conventions and lint, drive documents attached and indexed, and `erp.wiki.ask(slug, question)` retrieval over them. Use when the task involves the ERP wiki or knowledge base, recording what the workspace has concluded, attaching a document and asking questions about it, or citing where an answer came from ("write this into the wiki", "what do we know about this supplier", "ask the contract PDF"). Records are erp-data; the drive itself is erp-tools.
---

# The ERP wiki

One wiki per workspace, holding **what the organisation has concluded** — written
once and linked, instead of re-derived from chat and files each time. Pages are
drafted, published and linted; documents attached to a page are indexed so `ask` can
retrieve the passages that answer a question.

```ts
import { createMiniApp } from "erp-sdk";

const erp = await createMiniApp({
  baseUrl: process.env.ERP_BASE_URL,
  apiKey: process.env.ERP_API_KEY,
  permissions: [{ resource: "wiki", action: "read" }],
});
```

| Action | Permission |
| --- | --- |
| Read, search, `ask` | `wiki:read` — every role, including a mini app's `writer` key |
| Draft, edit, ingest, attach, lint | `wiki:create` / `wiki:update` |
| Publish, change settings | `wiki:manage` |

A service-account key cannot write the wiki. Check `npx erp whoami` before promising
an edit.

## 1. Read before writing

The catalog is generated per request, so it never drifts from the pages — start there:

```ts
const catalog = await erp.wiki.catalog();                                 // grouped by type
const concepts = await erp.wiki.catalog({ type: "concept", status: "published" });
const matches = await erp.wiki.search("tồn kho", { limit: 10 });
const page = await erp.wiki.page("chinh-sach-ton-kho");                   // body, sources, links
const { conventions, taxonomy } = await erp.wiki.settings();
```

To answer a question: **catalog → page → read it → `ask` its documents** if the answer
is in an attachment. Going straight to `search` skips the map and finds pages that
merely mention the words. Read `conventions` before writing a page, and write to them.

## 2. The slug is the address

```ts
import { wikiSlug } from "erp-sdk";
wikiSlug("Chính sách tồn kho");   // "chinh-sach-ton-kho" — accents fold, they don't vanish
```

The slug is fixed at creation and **does not follow the title**. A second page with
the same title gets a random suffix, so keep the slug the create call returned instead
of re-deriving it. A wrong slug is `UnknownWikiPageError`; find the right one with
`search`.

## 3. Pages

| `type` | Holds | Example |
| --- | --- | --- |
| `entity` | One thing that exists | "Nhà cung cấp Minh Long" |
| `concept` | An idea, policy or process | "Chính sách tồn kho" |
| `comparison` | Several things side by side | "Kho Bình Dương vs Long An" |
| `query` | One investigation, filed | "Vì sao tồn kho nhóm A tăng Q2" |

```ts
const created = await erp.wiki.createPage({
  title: "Chính sách tồn kho",
  type: "concept",
  summary: "Mức tồn tối thiểu theo nhóm hàng và ai được duyệt vượt mức.",   // one line
  body: "Nhóm A giữ 30 ngày. Quy trình nhập: [[quy-trinh-nhap-kho]].",
  tags: ["kho"],                                                            // from the taxonomy
  confidence: "medium",
  sourceIds: [source.id],
});
created.status;   // always "draft"
```

- **Create a page only past a threshold**: mentioned in ≥ 2 sources, or central to one.
  Below it, add a paragraph to an existing page.
- **Give every page ≥ 2 outbound `[[links]]`**; a page with none in or out is an orphan.

## 4. Draft, publish, archive

```ts
await erp.wiki.updatePage(slug, { body, confidence: "high" });  // back to draft
await erp.wiki.publishPage(slug);                               // wiki:manage
await erp.wiki.archivePage(slug);                               // retired; links into it still resolve
await erp.wiki.deletePage(slug);                                // links into it break
```

Every edit returns a published page to `draft`; readers keep seeing the published
version until someone publishes again. **Publishing says the workspace stands behind
the page: ask the user first**, and never publish claims without a source. To retire a
page, archive it — deleting leaves broken links behind.

## 5. Sources and attachments

```ts
// Source: text ingested into the wiki, immutable, cited by pages through sourceIds
const source = await erp.wiki.ingestSource({
  kind: "note",                              // article | paper | transcript | note
  title: "Biên bản họp kho 08/2026",
  body: text,
  sourceUrl: "https://…",
});

// Attachment: a drive file copied into the wiki and indexed for ask
const attached = await erp.wiki.attachFile(slug, file.id);   // 202, indexing queued
await erp.wiki.waitForIndex(attached.id);                    // check indexStatus: ready | failed
```

Changed content is a new source; that keeps citations stable.

> **Attaching a file discloses it to the whole wiki.** The copy stops following the
> file's own sharing, so everyone who can read the wiki can ask what it says. Confirm
> with the user before attaching anything shared narrowly.

## 6. `ask` retrieves, it does not answer

```ts
const passages = await erp.wiki.ask(slug, "Nhóm A giữ tồn tối thiểu bao nhiêu ngày?", { limit: 5 });
for (const p of passages) console.log(`${p.source}: ${p.text}`, p.link);
```

It searches **that page's attachments only**, matches by meaning and by exact wording,
and returns passages, not prose. Every claim built on them cites `p.source` and
`p.link`. Details, index states and composing a cited answer: `references/retrieval.md`.

## 7. Lint

```ts
const report = await erp.wiki.lint();   // wiki:update — stamps lintedAt and writes to the log
```

Lint reports broken links, orphans, `contested` pages, stale pages, thin provenance
and tags outside the taxonomy. Treat the findings as the next round of work.

## Before saying it's done

- [ ] Read `settings().conventions` and followed them.
- [ ] The slug came from the create call.
- [ ] `summary` is one scannable line.
- [ ] ≥ 2 outbound links, and `(await erp.wiki.handle(slug)).brokenLinks` is empty.
- [ ] Every number or claim traces to `sourceIds` or an attached document.
- [ ] Left as a draft, and asked before publishing.
- [ ] Told the user what an attachment exposed, if one was added.

## Pitfalls

| Symptom | Cause |
| --- | --- |
| `UnknownWikiPageError` on a page you can see | The title was passed; the address is the slug |
| Edits "disappear" | The edit returned the page to `draft`; readers still see the published version |
| `ask` returns nothing | Attachment still `pending`, or `failed` |
| `indexStatus: "failed"` | Usually uploaded as `application/octet-stream`; set `mimeType` on upload |
| `ask` answers 503 | The indexer or embedding model is down, not an empty page |
| Duplicate pages on one topic | The catalog was not read first |
| New broken links after a cleanup | `delete` was used where `archive` was meant |
| 403 on publish | Publishing takes `wiki:manage` |

## References

- `references/writing.md` — page fields, conventions and taxonomy, links, create vs
  extend, sources, lint findings, the log.
- `references/retrieval.md` — attaching, index states, `ask` in depth, cited answers.
- Skill `erp-tools` — uploading the documents you attach.
- Skill `erp-data` — records, SQL and analysis.
