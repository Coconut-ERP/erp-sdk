# Attachments and retrieval

The page holds the conclusion; its attachments hold the evidence; `ask` goes from a
question to the exact passages.

## Contents

- [Pipeline](#pipeline)
- [Attaching is a disclosure](#attaching-is-a-disclosure)
- [Index states](#index-states)
- [`ask`](#ask)
- [From passages to an answer](#from-passages-to-an-answer)

## Pipeline

```
files.upload(...)            → a document in the drive
wiki.attachFile(slug, id)    → 202: copied into the wiki, indexing queued
wiki.waitForIndex(sourceId)  → pending → indexing → ready | failed
wiki.ask(slug, question)     → passages, each with its source
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

## Attaching is a disclosure

From the moment of attaching, the copy belongs to the wiki:

- the file's own sharing stops applying;
- everyone who can read the wiki can ask what it says and read the passages;
- the only check is that the person attaching can read the file.

Confirm before attaching anything shared with a few people, and say what it exposes.
Detaching removes the copy — and its passages and images once no page points at it —
but cannot undo what people already read.

## Index states

| `indexStatus` | Meaning |
| --- | --- |
| `pending` / `indexing` | Queued or running; `ask` finds nothing in it yet |
| `ready` | Searchable |
| `failed` | Never searchable; `indexError` says why |

`waitForIndex` does not throw on `failed`, and on timeout it returns without stopping
the indexing — check the status it returns. A large PDF can outlast the default wait.
The usual `failed` cause is an upload under an unmapped extension, stored as
`application/octet-stream`; pass `mimeType` at upload.

## `ask`

```ts
const passages = await erp.wiki.ask(slug, question, { limit: 8 });   // limit ≤ 20

for (const p of passages) {
  p.text;          // the passage
  p.source;        // document title — what you cite
  p.headingPath;   // position in the document, when it had headings
  p.pageNumber;    // for paginated documents
  p.link;          // back to the page and passage
  p.score;         // relevance; results are already ordered by it
}
```

1. **One page's attachments, nothing else** — not the wiki, not the drive. To widen,
   find the page with `catalog()` / `search()` first. When the right page is unclear,
   ask the user rather than looping `ask` over many pages.
2. **Hybrid matching** — meaning and wording together, so a natural question works
   and a part number or invoice code still matches literally. Pass the question as
   asked; don't reduce it to keywords.
3. **Retrieval only** — the passages are context to reason over or quotes to show.

A 503 means the indexer or embedding model is unavailable; retry, and say so.

## From passages to an answer

```ts
const passages = await erp.wiki.ask(slug, question, { limit: 6 });
if (passages.length === 0) {
  return `No document attached to "${slug}" answers this.`;
}
const context = passages
  .map((p, i) => `[${i + 1}] ${p.source}${p.pageNumber ? ` p.${p.pageNumber}` : ""}\n${p.text}`)
  .join("\n\n");
// give `context` to the model and require a [n] citation on every claim
```

- **Never state what the passages do not contain.** No results is an answer: the
  documents do not cover it.
- **Cite every claim** with `p.source` and `p.link`.
- **Read the page before the passages.** The page is the workspace's conclusion; a
  passage that contradicts it is a `contested` finding to raise with the user, not
  something to smooth over.
- **Don't paste passages into a page body** as the wiki's own words — summarise, and
  cite the source in `sourceIds`.
