---
name: erp-wiki
description: Write and maintain the Coconut ERP workspace wiki, and retrieve from it — pages (entity/concept/comparison/query), immutable sources, `[[slug]]` wikilinks, catalog and log, the lint pass, drive documents attached to a page and indexed, and `erp.wiki.ask(slug, question)` retrieval (RAG) over them. Use when the task involves the ERP wiki or knowledge base, writing up what a workspace has concluded, `erp.wiki`, wiki pages/slug/publish/archive/lint, ingesting sources, attaching a PDF and asking questions about it, citing where an answer came from, or when the user says "write this into the wiki", "what do we know about X", "ask the document", "build a knowledge base on ERP", "our notes about this supplier". Reading and writing records is the erp-data skill; the drive itself is `references/files.md` there.
---

# The ERP Wiki

One wiki per workspace: **what this organisation has concluded**, written once and
linked together, instead of the same answer being re-derived from chat and files every
time. Pages are drafted, published, linted; documents attached to a page are indexed so
`ask` can retrieve the passages that answer a question.

It is a wiki-for-LLMs model — four page types, immutable sources, `[[slug]]` links, a
generated catalog, an append-only log, a lint pass — plus retrieval over attached
documents, which is the part the classic model does not have.

```ts
import { createMiniApp } from "erp-sdk";

const erp = await createMiniApp({
  baseUrl: process.env.ERP_BASE_URL,
  apiKey: process.env.ERP_API_KEY,
  permissions: [{ resource: "wiki", action: "read" }],
});
```

Reading takes `wiki:read`, the floor every role holds. Writing takes
`wiki:create`/`wiki:update`; **publishing and setting the conventions take
`wiki:manage`**. A mini app's service account is a `writer`: it reads the wiki and
cannot write it. Check with `npx erp whoami` before promising the user an edit.

## 1. Read before you write — always

The catalog is generated per request, so it can never drift from the pages. It is the
cheapest possible orientation and it is the first call in almost every task:

```ts
const catalog = await erp.wiki.catalog();                      // grouped by type
const concepts = await erp.wiki.catalog({ type: "concept", status: "published" });
const matches = await erp.wiki.search("tồn kho", { limit: 10 });
const page = await erp.wiki.page("chinh-sach-ton-kho");        // body + sources + links
```

Answering a question from the wiki: **catalog → pick the page → read it → `ask` its
documents if the answer is in an attachment**. Going straight to `search` skips the map
and finds pages that merely mention the words.

## 2. Slug is the address, not the title

```ts
import { wikiSlug } from "erp-sdk";
wikiSlug("Chính sách tồn kho");   // "chinh-sach-ton-kho"
wikiSlug("Hoá đơn bán hàng");     // "hoa-don-ban-hang" — accents fold, they don't vanish
```

The slug is folded once at creation and **does not move when the title changes**. The
first page to claim a name keeps the readable slug; a second page with the same title
gets a random suffix — so **keep the slug the create call returned**, don't re-derive
it. A wrong slug is `UnknownWikiPageError`; find the right one with `search`.

## 3. Four page types, and a threshold for making one

| `type` | Holds | Example |
| --- | --- | --- |
| `entity` | one thing that exists | "Nhà cung cấp Minh Long" |
| `concept` | an idea, policy, process | "Chính sách tồn kho" |
| `comparison` | several things side by side | "Kho Bình Dương vs Long An" |
| `query` | one investigation, filed | "Vì sao tồn kho nhóm A tăng Q2" |

```ts
const page = await erp.wiki.createPage({
  title: "Chính sách tồn kho",
  type: "concept",
  summary: "Mức tồn tối thiểu theo nhóm hàng và ai được duyệt vượt mức.",   // ONE line
  body: "Nhóm A giữ 30 ngày. Quy trình nhập xem [[quy-trinh-nhap-kho]].",
  tags: ["kho"],                       // inside the taxonomy — lint checks
  confidence: "medium",
  sourceIds: [source.id],
});
page.status;   // "draft" — always, no exceptions
```

**Don't create a page for everything you just read.** The working threshold: it is
mentioned in **≥ 2 sources**, or it is **central to one**. A wiki full of one-line pages
turns its own catalog into noise. Below the threshold, add a paragraph to an existing
page instead.

Every page should carry **≥ 2 outbound `[[links]]`**. A page nothing links to and that
links to nothing is an orphan, and lint says so.

## 4. Draft → publish, and never delete when you mean archive

```ts
await erp.wiki.updatePage(slug, { body, confidence: "high" });  // → back to draft
await erp.wiki.publishPage(slug);      // wiki:manage
await erp.wiki.archivePage(slug);      // retires it; links into it still resolve
await erp.wiki.deletePage(slug);       // links into it become BROKEN
```

Every edit to a published page returns it to `draft` — changing what the workspace
relies on asks for the decision again. That is a feature; don't work around it by
editing and forgetting to publish.

`archive` is almost always what is meant: `delete` does not remove the links pointing
at the page, it only turns them into broken links for lint to report.

**Publishing is a decision about what the workspace stands behind.** Ask the user before
publishing something you drafted, and never publish a page whose claims you could not
source.

## 5. Provenance: sources vs attachments

They are not interchangeable.

```ts
// A source: text ingested into the wiki, immutable, cited by pages.
const source = await erp.wiki.ingestSource({
  kind: "note",                  // article | paper | transcript | note
  title: "Biên bản họp kho 08/2026",
  body: text,
  sourceUrl: "https://…",
});

// An attachment: a drive file copied into the wiki and indexed for `ask`.
const attached = await erp.wiki.attachFile(slug, file.id);   // 202 — indexing is queued
await erp.wiki.waitForIndex(attached.id);                    // pending → indexing → ready
```

Sources are **immutable**: changed content is a new source, which is what makes a
citation stable.

> **Attaching a file publishes it to the whole wiki.** The copy belongs to the wiki from
> that moment: the file's own sharing stops applying, so everyone who may read the wiki
> may ask what the document says. Confirm with the user before attaching anything that
> was shared narrowly.

## 6. `ask` — retrieval, not an answer

```ts
const passages = await erp.wiki.ask(slug, "Nhóm A giữ tồn tối thiểu bao nhiêu ngày?", { limit: 5 });
for (const p of passages) console.log(`${p.source}: ${p.text}`, p.link);
```

- Scoped to **that page's attached documents and nothing else**. To widen, search the
  catalog first and ask inside the page you land on.
- Matches by meaning **and** by wording, so a plain question works and a part number
  still matches literally.
- It **retrieves**; it does not compose an answer. What comes back is context for a
  model or quotes for a person — and every claim you then write should cite
  `p.source`/`p.link`.
- `indexStatus: "failed"` means that document will never be found; the usual cause is a
  file uploaded with an unknown extension, so its MIME is `application/octet-stream`.
- `503` is the indexer or embedding model being unavailable — not an empty page.

## 7. Conventions and lint

```ts
await erp.wiki.setSettings({
  domain: "Vận hành kho và mua hàng",
  conventions: "Mỗi trang ≥ 2 link ra. Số liệu phải có nguồn. Không đoán.",
  taxonomy: ["kho", "mua-hang", "nha-cung-cap"],
});

const report = await erp.wiki.lint();   // wiki:update — it stamps lintedAt and logs
```

`conventions` is the house style every page is held to — read it **before writing a
page**, and write to it. Lint reports broken links, orphans, `contested` pages, stale
pages, thin provenance and tags outside the taxonomy; its findings are the next round of
work, not a score.

## 8. The loop, condensed

```
catalog  →  does a page already cover this?
   │              │ yes → update (→ draft) → ask user → publish
   │ no
   ▼
ingestSource / attachFile  →  createPage (≥ 2 outbound links, summary in one line)
   │
   ▼
lint periodically → fix broken links, orphans, off-taxonomy tags
```

## Checklist before you say you're done

- [ ] Read `settings().conventions` and wrote to it.
- [ ] Page slug came from the create call, not from guessing.
- [ ] `summary` is one line a person can scan in the catalog.
- [ ] ≥ 2 outbound `[[links]]`, and `page.brokenLinks` is empty.
- [ ] Every number or claim traces to a `sourceIds` entry or an attached document.
- [ ] Left it as a draft and **asked** before publishing.
- [ ] Told the user what attaching a document exposed, if you attached one.

## Pitfalls

| Symptom | Cause |
| --- | --- |
| `UnknownWikiPageError` on a page you can see | You passed the title; the address is the slug |
| Page edits "disappear" | Editing returned it to `draft`; the published version is still what people read |
| `ask` returns nothing | Attachment still `pending`, or `failed` — check `waitForIndex` |
| Duplicate pages on one topic | Nobody read the catalog first |
| Lint reports orphans after a cleanup | `delete` was used where `archive` was meant |
| 403 on publish | Publishing takes `wiki:manage`; drafting only takes `create`/`update` |

## References

- `references/writing.md` — page anatomy, the conventions/taxonomy, link discipline,
  lint findings and what to do about each.
- `references/retrieval.md` — attachments, indexing states, `ask` in depth, and how to
  turn passages into a cited answer.
- Uploading the documents you attach → skill **`erp-data`**, `references/files.md`.
- Records, SQL and analysis → skill **`erp-data`**.
