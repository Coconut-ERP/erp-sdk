---
name: erp-wiki
description: Writes, maintains and retrieves from the Coconut ERP workspace wiki with erp-sdk — pages (entity, concept, comparison, query) addressed by slug with per-page visibility and sharing grants, immutable sources, `[[slug]]` links, draft/publish/archive, conventions and lint, drive documents attached and indexed, and `erp.wiki.askWiki(query, { autoRetrieve })` retrieval across the whole wiki. Use when the task involves the ERP wiki or knowledge base, recording what the workspace has concluded, attaching a document and asking questions about it, sharing or restricting a page, or citing where an answer came from ("write this into the wiki", "what do we know about this supplier", "ask the contract PDF"). Records are erp-data; the drive itself is erp-tools.
---

# The ERP wiki

One wiki per workspace, holding **what the organisation has concluded** — written
once and linked, instead of re-derived from chat and files each time. Pages are
drafted, published and linted; documents attached to a page are indexed so `askWiki`
can retrieve the passages that answer a question.

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
| Read, search, `askWiki` | `wiki:read` — every role, including a mini app's `writer` key |
| Draft, edit, ingest, attach, lint, read the log | `wiki:create` / `wiki:update` |
| Publish, change settings | `wiki:manage` |

A service-account key cannot write the wiki. Check `npx erp whoami` before promising
an edit.

**On top of the gate, each page has its own ACL.** `visibility: "workspace"` is
open to everyone the gate lets in; `"restricted"` limits the page to its creator
plus granted subjects (read < write < manage). An excluded member gets a **404,
not a 403** — the page is simply not there for them, and a `[[link]]` to it reads
as unresolved. Sources carry no ACL of their own: anyone who can read one page
citing a source can read that source, so **citing is publishing**.

## 1. Read before writing

The catalog is generated per request, so it never drifts from the pages — start there:

```ts
const catalog = await erp.wiki.catalog();                                 // grouped by type
const concepts = await erp.wiki.catalog({ type: "concept", status: "published" });
const matches = await erp.wiki.search("tồn kho", { limit: 10 });
const page = await erp.wiki.page("chinh-sach-ton-kho");                   // body, sources, links
const { conventions, taxonomy } = await erp.wiki.settings();
```

This is the map for **writing** — find the page to extend before creating one. To
**answer a question**, don't walk the catalog page by page: use the retrieval loop in
§6. Read `conventions` before writing a page, and write to them.

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
- **Citing a source publishes it** to the page's readers — you may only cite sources
  you can read yourself, and on an open page that means the whole wiki.

Pages an SDK key creates are `workspace`-visible; `restricted` pages are set up in
the ERP app. The SDK reads a page's sharing, it does not change it:

```ts
const { visibility, entries } = await erp.wiki.pageSharing(slug);   // takes page manage
const me = (await erp.wiki.page(slug)).access;                    // "read" | "write" | "manage"
```

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

> **Attaching a file discloses it to the page's readers.** The copy stops following
> the file's own sharing, so everyone who can read the page can ask what it says —
> and on a `workspace` page that is the whole wiki. Confirm with the user before
> attaching anything shared narrowly, or restrict the page first.

## 6. Answering a question: the retrieval loop

Don't hop from page to page asking each one. One call searches the wiki, and the
server picks the pages:

1. **Rewrite the question into a query.** Make it standalone: resolve "it"/"that
   one" from the conversation, spell out abbreviations, keep codes, names and
   numbers verbatim, and write it in the language the documents use. Add up to 4
   alternate phrasings as `queries` (synonyms, the other language, the formal
   term). The wiki does not expand queries, so this step is yours.
2. **`askWiki` with `autoRetrieve: true`.** The server picks the pages for the
   query and searches only those, plus the sources they cite. That page selection
   has no call of its own; `autoRetrieve` is the only way to use it.
   1. **Empty → ask again with no `pages`.** That searches every page and source
      you may read. An empty retrieval returns `[]`; it does not widen the search
      by itself.
   2. **Still empty → broaden the query and go back to step 2.** Drop the narrow
      qualifiers (a date, a figure, a site name) or move up to the parent concept.
      Stop after two broadened rounds.
3. **Return the passages with citations.** If nothing turned up, the answer is that
   the wiki does not cover the question. Don't fill the gap yourself.

```ts
import { ErpApiError, type WikiPassageDto } from "erp-sdk";

async function findPassages(query: string, queries: string[]): Promise<WikiPassageDto[]> {
  const scoped = await erp.wiki
    .askWiki(query, { queries, autoRetrieve: true, limit: 8 })
    .catch((e) => {
      if (e instanceof ErpApiError && e.status === 503) return [];   // page selection has no decisions model
      throw e;
    });
  if (scoped.length > 0) return scoped;
  return erp.wiki.askWiki(query, { queries, limit: 8 });              // no pages = whole wiki
}

let passages = await findPassages("Tồn kho tối thiểu nhóm A bao nhiêu ngày", [
  "safety stock nhóm A",
  "mức tồn an toàn hàng nhóm A",
]);
if (passages.length === 0) {
  passages = await findPassages("chính sách tồn kho tối thiểu", ["safety stock policy"]);
}
```

`askWiki` retrieves; it doesn't write the answer. Every passage carries `p.source`
(cite it, with `p.headingPath`/`p.pageNumber`), `p.pageSlug`/`p.pageSlugs` (the pages
it belongs to) and `p.link` (the page, or an `excerpt` range to read around the hit).

When the user names a page or document, pass it as `pages: [slug]`: that searches
the page's sources and body and nothing else. Details, index states and composing a
cited answer are in `references/retrieval.md`.

## 7. Lint

```ts
const report = await erp.wiki.lint();   // wiki:update — stamps lintedAt and writes to the log
const { entries } = await erp.wiki.log({ perPage: 50 });   // also wiki:update — it names restricted pages
```

Lint reports broken links, orphans, `contested` pages, stale pages, thin provenance
and tags outside the taxonomy — scoped to what you may read. Treat the findings as
the next round of work.

## Before saying it's done

- [ ] Read `settings().conventions` and followed them.
- [ ] The slug came from the create call.
- [ ] `summary` is one scannable line.
- [ ] ≥ 2 outbound links, and `(await erp.wiki.handle(slug)).brokenLinks` is empty.
- [ ] Every number or claim traces to `sourceIds` or an attached document.
- [ ] `page.visibility` / `detail.access` checked — a restricted page you can't
  reach answers `UnknownWikiPageError`, don't work around it.
- [ ] Left as a draft, and asked before publishing.
- [ ] Told the user what an attachment or a citation exposed, if one was added.

## Pitfalls

| Symptom | Cause |
| --- | --- |
| `UnknownWikiPageError` on a page you can see | The title was passed; the address is the slug |
| `UnknownWikiPageError` on a page others can see | It is `restricted` and you hold no grant — exclusion reads as absence |
| Edits "disappear" | The edit returned the page to `draft`; readers still see the published version |
| `autoRetrieve` returns `[]` | The server picked no page. Ask again with no `pages`, then broaden |
| Nothing found even across the whole wiki | Sources are still `pending` or `failed`, or the wiki really doesn't cover it |
| Looping `askWiki` over page after page | Use `autoRetrieve` or no `pages`; one call searches the whole wiki |
| `indexStatus: "failed"` | Usually uploaded as `application/octet-stream`; set `mimeType` on upload |
| 503 with `autoRetrieve` | No decisions model for page selection; ask with no `pages` |
| 503 without `autoRetrieve` | The indexer or embedding model is down, not an empty wiki |
| Duplicate pages on one topic | The catalog was not read first |
| New broken links after a cleanup | `delete` was used where `archive` was meant |
| 403 on publish | Publishing takes `wiki:manage` |
| 403 citing a source | You can't read it yourself; citing publishes it to the page's readers |

## References

- `references/writing.md` — page fields, conventions and taxonomy, links, create vs
  extend, sources, lint findings, the log.
- `references/retrieval.md` — attaching, index states, the retrieval loop in depth,
  cited answers.
- Skill `erp-tools` — uploading the documents you attach.
- Skill `erp-data` — records, SQL and analysis.
