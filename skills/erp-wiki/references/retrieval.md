# Attachments and retrieval

The page holds the conclusion; its sources hold the evidence; `askWiki` goes from a
question to the exact passages.

## Contents

- [Pipeline](#pipeline)
- [Attaching is a disclosure](#attaching-is-a-disclosure)
- [Index states](#index-states)
- [The retrieval loop](#the-retrieval-loop)
- [Passages](#passages)
- [Asking one page](#asking-one-page)
- [Reading around a hit](#reading-around-a-hit)
- [From passages to an answer](#from-passages-to-an-answer)

## Pipeline

```
files.upload(...)            → a document in the drive
wiki.attachFile(slug, id)    → 202: copied into the wiki, indexing queued
wiki.ingestSource({…})       → pasted text, also queued for indexing
wiki.waitForIndex(sourceId)  → pending → indexing → ready | failed
wiki.askWiki(query, {…})     → passages from across the wiki, each with its source and a link
```

```ts
const folder = await erp.files.personalFolder();
const file = await erp.files.upload({
  folderId: folder.id,
  name: "quy-che-kho-2026.pdf",
  content: pdfBytes,
  mimeType: "application/pdf",     // an unknown type is never indexed
});

const source = await erp.wiki.attachFile("chinh-sach-ton-kho", file.id);
const ready = await erp.wiki.waitForIndex(source.id, { timeoutMs: 180_000 });
if (ready.indexStatus === "failed") throw new Error(ready.indexError);
```

Pasted sources are indexed the same way. Once an ingested note's `indexStatus` is
`ready`, it is searchable through every page that cites it. A published page's own
body is indexed as well; drafts and archived pages are not.

## Attaching is a disclosure

From the moment of attaching, the copy belongs to the wiki:

- the file's own sharing stops applying;
- everyone who can read the **page** can ask what it says and read the passages —
  on a `restricted` page that stays narrow, on a `workspace` page it is everyone
  the `wiki` gate lets in (page visibility is managed in the ERP app);
- the only check is that the person attaching can read the file.

Confirm before attaching anything shared with a few people, and say what it
exposes. Detaching removes the copy — and its passages and images once no page
points at it — but cannot undo what people already read.

## Index states

| `indexStatus` | Meaning |
| --- | --- |
| `pending` / `indexing` | Queued or running; nothing in it is searchable yet |
| `ready` | Searchable |
| `failed` | Never searchable; `indexError` says why |
| unset | Indexing is not configured on this workspace; every ask answers 503 |

`waitForIndex` does not throw on `failed`, and on timeout it returns without
stopping the indexing — check the status it returns. A large PDF can outlast the
default wait. The usual `failed` cause is an upload under an unmapped extension,
stored as `application/octet-stream`; pass `mimeType` at upload.

A `ready` copy is frozen: it is never read from the drive again, so editing or
replacing the file there changes nothing the wiki answers with, and lint does not
flag it. To index a new version, detach the file and attach it again — it becomes a
new source. Attaching a file that is already on the page answers 409.

```ts
await erp.wiki.detachFile(slug, oldSource.id);
const fresh = await erp.wiki.attachFile(slug, file.id);
await erp.wiki.waitForIndex(fresh.id);
```

## The retrieval loop

To answer a question, don't open pages one at a time and ask each of them.
`askWiki` searches the wiki in one call, and the server picks the pages:

| Step | Call | Searches |
| --- | --- | --- |
| 1 | You rewrite the question into `query` plus up to 4 `queries` | — |
| 2 | `askWiki(query, { queries, autoRetrieve: true })` | The pages the server picks, plus the sources they cite |
| 2.1 | Empty → `askWiki(query, { queries })` | Every page and source you may read |
| 2.2 | Still empty → broaden `query`, back to step 2 | — |
| 3 | Return the passages, cited | — |

**Step 1: rewrite.** The user's words are rarely the best query. Make it standalone:
replace "it", "that supplier" and "last month" with what they refer to, and spell out
abbreviations. Keep codes, part numbers and names exactly as written, because the
lexical leg matches them literally. Write in the language of the documents. Use
`queries` for other wordings: a synonym, the English term, the formal name. Each
phrasing is at least 2 characters and there are at most 4.

**Step 2: `autoRetrieve`.** The server first picks pages by search and by a walk
over `[[links]]` judged by a decisions model, then searches only those pages. That
is the precise pool, but when it picks no page the call returns `[]` without
searching anything. The page selection has no call of its own in the SDK;
`autoRetrieve` is the only way to use it.

**Step 2.1: the whole wiki.** Ask again without `pages` and without `autoRetrieve`.
That searches every published page and indexed source you may read. Restricted
pages you are not granted, and sources only they cite, are never candidates.

**Step 2.2: broaden.** Drop the narrow qualifiers (year, figure, site, person), or
ask about the parent concept instead ("tồn kho tối thiểu nhóm A tháng 8" →
"chính sách tồn kho tối thiểu"). Then run step 2 again. Stop after two broadened
rounds, and report that the wiki doesn't cover the question.

```ts
import { ErpApiError, type WikiPassageDto } from "erp-sdk";

async function findPassages(query: string, queries: string[]): Promise<WikiPassageDto[]> {
  const scoped = await erp.wiki
    .askWiki(query, { queries, autoRetrieve: true, limit: 8 })
    .catch((e) => {
      if (e instanceof ErpApiError && e.status === 503) return [];
      throw e;
    });
  if (scoped.length > 0) return scoped;
  return erp.wiki.askWiki(query, { queries, limit: 8 });
}

const rounds: Array<[string, string[]]> = [
  ["Tồn kho tối thiểu nhóm A tháng 8/2026", ["safety stock nhóm A", "mức tồn an toàn nhóm A"]],
  ["Tồn kho tối thiểu nhóm A", ["safety stock group A"]],
  ["chính sách tồn kho tối thiểu", ["safety stock policy"]],
];
let passages: WikiPassageDto[] = [];
for (const [query, queries] of rounds) {
  passages = await findPassages(query, queries);
  if (passages.length > 0) break;
}
```

In practice you write the broader round only after the narrower one comes back
empty. The array above just shows how the rounds progress.

A 503 **with** `autoRetrieve` means page selection has no decisions model
configured. Skip to step 2.1. A 503 **without** it means the indexer or embedding
model is down. Retry once, then tell the user; it doesn't mean the wiki is empty.

The server caches its page selection by meaning for 7 days, per reader, so asking
the same question again is cheap.

## Passages

```ts
for (const p of passages) {
  p.text;          // the passage — a hit merged with its ±1 neighbours
  p.source;        // document or page title — what you cite
  p.docKind;       // "source" | "page"
  p.kind;          // "text" | "image" (an image carries p.imageUrl instead)
  p.seq;           // position inside the document — feeds excerpt()
  p.sourceId;
  p.fileId;        // the drive file a source came from, when it did
  p.headingPath;   // position in the document, when it had headings
  p.pageNumber;    // for paginated documents
  p.pageSlug;      // the page, when docKind is "page"
  p.pageSlugs;     // readable pages citing this source
  p.link;          // "/ai-wiki/pages/{slug}" or the excerpt path of the hit
  p.score;         // relevance; results are already ordered by it
}
```

- **Hybrid matching.** Dense embeddings and a word-level pass are fused, then
  reranked, so a natural question works and a part number or invoice code still
  matches literally.
- **`limit`** is at most 20 and defaults to 8. `pages` takes at most 50 ids or slugs.
  If none of the named pages is readable, the call throws `UnknownWikiPageError`.
- **Retrieval only.** The passages are context to reason over or quotes to show.

## Asking one page

```ts
const passages = await erp.wiki.askWiki(question, { pages: [slug], queries, limit: 8 });
```

Naming one page searches its pool and nothing else: its indexed sources (cited
through `sourceIds` and attached documents, which are the same link) plus the
page's body once published. Use it when the user names the page or the document
("ask the contract PDF"), or right after attaching a file to check that it answers.
For an open question, use the retrieval loop above.

## Reading around a hit

A passage arrives merged with its neighbours; when even that is not enough,
`excerpt` reads a wider window of the same document — it is what `p.link` points
at for source passages:

```ts
const { text } = await erp.wiki.excerpt(p.sourceId, {
  from: Math.max(0, p.seq - 5),
  to: p.seq + 5,              // the window is capped at 20 seqs
});
```

## From passages to an answer

```ts
const passages = await findPassages(query, queries);
if (passages.length === 0) {
  return "The wiki does not cover this.";
}
const context = passages
  .map((p, i) => `[${i + 1}] ${p.source}${p.pageNumber ? ` p.${p.pageNumber}` : ""}\n${p.text}`)
  .join("\n\n");
// give `context` to the model and require a [n] citation on every claim
```

- **Never state what the passages do not contain.** No results is an answer: the
  documents do not cover it.
- **Cite every claim** with `p.source` (plus `p.headingPath` / `p.pageNumber` when
  present). `p.link` leads back to the page or the excerpt range when a reader
  wants the original.
- **Passages from a source can contradict a page.** When they conflict with
  `p.pageSlugs`, the page holds the workspace's conclusion. Raise the conflict with
  the user as a `contested` finding instead of smoothing it over. Open the page
  (`wiki.page(slug)`) only when the passages leave the answer ambiguous.
- **Don't paste passages into a page body** as the wiki's own words — summarise, and
  cite the source in `sourceIds`.
