# Attachments and Retrieval (RAG)

A page can carry documents, and the wiki indexes them so a question can be answered out
of what they actually say. This is the half a plain wiki does not have: the page holds
the conclusion, the attachments hold the evidence, and `ask` gets you from a question to
the exact passages.

## The pipeline

```
files.upload(...)            → a document in the drive
   │
wiki.attachFile(slug, id)    → 202: copied into the wiki, indexing queued
   │
wiki.waitForIndex(sourceId)  → pending → indexing → ready | failed
   │
wiki.ask(slug, question)     → the passages that answer it, each with its source
```

```ts
const folder = await erp.files.personalFolder();
const file = await erp.files.upload({
  folderId: folder.id,
  name: "quy-che-kho-2026.pdf",
  content: pdfBytes,
  mimeType: "application/pdf",     // set it — an unknown type will not be indexed
});

const source = await erp.wiki.attachFile("chinh-sach-ton-kho", file.id);
const ready = await erp.wiki.waitForIndex(source.id, { timeoutMs: 180_000 });
if (ready.indexStatus === "failed") throw new Error(ready.indexError);
```

## Attaching is a disclosure — say so

The copy belongs to the wiki from the moment it is attached:

- the file's **own sharing stops applying**;
- everyone who may read the wiki may ask what the document says, and read the passages
  that come back;
- the person attaching must be able to read the file themselves, and that is the only
  check.

So: confirm with the user before attaching anything that was shared with a few people,
and say plainly what attaching it exposes. Detaching removes the copy (and, when no page
points at it any more, its passages and extracted images), but it does not un-read what
people already read.

## Index states

| `indexStatus` | Means |
| --- | --- |
| `pending` / `indexing` | Queued or in progress — `ask` finds nothing in it yet |
| `ready` | Searchable |
| `failed` | It will **never** be found; `indexError` says why |

`waitForIndex` polls and returns whatever it settles as — it does not throw on `failed`,
so check the status. It also returns on timeout without stopping the indexing; a large
PDF can outlast a default wait.

The most common `failed` cause is not the document at all: it was uploaded under an
extension the SDK could not map, so its MIME is `application/octet-stream`. Fix it at
upload time by passing `mimeType`.

## `ask` in practice

```ts
const passages = await erp.wiki.ask(slug, "Nhóm A giữ tồn tối thiểu bao nhiêu ngày?", {
  limit: 8,          // ≤ 20
});

for (const p of passages) {
  p.text;            // the passage itself
  p.source;          // the document's title — this is what you cite
  p.headingPath;     // where in the document, when the format had headings
  p.pageNumber;      // for paginated documents
  p.link;            // back to the page and passage, clickable in a citation
  p.score;           // relevance; ordering is already by it
}
```

Three properties decide how to use it:

1. **Scope is one page.** It searches that page's attachments and nothing else — not the
   wiki, not the drive. Widening means `catalog()`/`search()` first, then asking inside
   the page you land on. If the right page is unclear, ask the user which one rather than
   asking five pages in a loop.
2. **Hybrid matching.** Meaning and wording together, so a natural question works *and* a
   part number, an invoice code or a proper noun still matches literally. Don't
   pre-process the user's question into keywords; pass it as asked.
3. **It retrieves, it does not answer.** Nothing here writes prose. The passages are the
   context you reason over, or the quotes a person reads.

`503` means the indexer or the embedding model is unavailable — a service problem, not
an empty page. Retry, and say which it was.

## Turning passages into an answer

```ts
const passages = await erp.wiki.ask(slug, question, { limit: 6 });
if (passages.length === 0) {
  return `Không có tài liệu nào gắn ở trang "${slug}" trả lời được câu này.`;
}

const context = passages
  .map((p, i) => `[${i + 1}] ${p.source}${p.pageNumber ? ` tr.${p.pageNumber}` : ""}\n${p.text}`)
  .join("\n\n");
// hand `context` to the model, and require it to cite [n]
```

Rules worth keeping:

- **Never state something the passages do not contain.** Empty results are an answer:
  say the documents do not cover it.
- **Cite every claim** — `p.source` plus `p.link`. An answer from the wiki that cannot be
  traced is worth less than no answer.
- **Say when the evidence disagrees with the page.** If a passage contradicts what the
  page states, that is a `contested: true` finding for the user to resolve, not something
  to smooth over.
- **Don't paste passages into the page body** as if they were the wiki's own words.
  Summarise, and cite the source id in `sourceIds`.

## Answering a question end to end

```ts
// 1. Where would this live?
const catalog = await erp.wiki.catalog({ status: "published" });
// 2. Narrow by wording if the catalog is not obvious
const matches = await erp.wiki.search(question, { limit: 5 });
const slug = matches[0]?.slug;
// 3. Read what the workspace already concluded
const page = await erp.wiki.page(slug);
// 4. Only then go into the documents
const passages = await erp.wiki.ask(slug, question);
```

Step 3 matters: the page is the workspace's *conclusion*, the passages are raw material.
An answer that skips the page and quotes a document can contradict a decision that was
already made — and reporting that contradiction is more useful than either half alone.
