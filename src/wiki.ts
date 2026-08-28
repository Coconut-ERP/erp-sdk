import {
  DryRunUnsupportedError,
  ErpApiError,
  UnknownWikiPageError,
  WikiPageError,
} from "./errors";
import type { Http } from "./http";
import type { WriteOptions } from "./objects";
import type {
  PageMeta,
  WikiCatalogDto,
  WikiConfidence,
  WikiLintReportDto,
  WikiLogEntryDto,
  WikiPageDetailDto,
  WikiPageDto,
  WikiPageMatchDto,
  WikiPageStatus,
  WikiPageType,
  WikiPassageDto,
  WikiSettingsDto,
  WikiSourceDetailDto,
  WikiSourceDto,
  WikiSourceKind,
} from "./types";

/** The four kinds of page. What a page is *for* is also how it is written. */
export const WIKI_PAGE_TYPES: readonly WikiPageType[] = [
  "entity",
  "concept",
  "comparison",
  "query",
];

export const WIKI_CONFIDENCE_LEVELS: readonly WikiConfidence[] = [
  "high",
  "medium",
  "low",
];

/** Kinds of raw material a page may cite. */
export const WIKI_SOURCE_KINDS: readonly WikiSourceKind[] = [
  "article",
  "paper",
  "transcript",
  "note",
];

/** Server caps, in the order they are usually hit. */
export const MAX_WIKI_SLUG_LENGTH = 160;
export const MAX_WIKI_TITLE_LENGTH = 255;
export const MAX_WIKI_SUMMARY_LENGTH = 500;
export const MAX_WIKI_BODY_LENGTH = 200_000;
export const MAX_WIKI_SOURCE_BODY_LENGTH = 2_000_000;
export const MAX_WIKI_TAGS = 20;
export const MAX_WIKI_PAGE_SOURCES = 50;
export const MAX_WIKI_ASK_PASSAGES = 20;

/** An attached document is indexed in the background — these are the stages. */
export const WIKI_INDEX_PENDING_STATUSES: readonly string[] = [
  "pending",
  "indexing",
];

const DEFAULT_INDEX_TIMEOUT_MS = 120_000;
const DEFAULT_INDEX_POLL_MS = 2_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The slug a title becomes — the same folding the server applies, so a page's
 * address is predictable before it is created and a `[[link]]` can be written
 * to a page that does not exist yet.
 *
 * Vietnamese accents fold to their base letter rather than being dropped
 * ("Hoá đơn" → `hoa-don`, not `ho-n`), everything else becomes a dash, and the
 * result is cut to {@link MAX_WIKI_SLUG_LENGTH}.
 *
 * It predicts the *base* slug only. The first page to claim a name keeps it;
 * a second page with the same title gets a random suffix, which is why the
 * slug a create returns is the one to keep.
 */
export function wikiSlug(text: string): string {
  const folded = text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    // Combining accents, then the one Vietnamese letter no accent describes.
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");

  let slug = "";
  let dash = false;
  for (const char of folded) {
    if (/[a-z0-9]/.test(char)) {
      slug += char;
      dash = false;
    } else if (slug.length > 0 && !dash) {
      slug += "-";
      dash = true;
    }
  }
  return slug.slice(0, MAX_WIKI_SLUG_LENGTH).replace(/^-+|-+$/g, "");
}

export interface WikiPageSpec {
  title: string;
  type: WikiPageType;
  /** One line, and the only thing the catalog shows. Required. */
  summary: string;
  /** Markdown. `[[slug]]` links other pages; lint reports the broken ones. */
  body?: string;
  /** Defaults to `wikiSlug(title)`; the server folds whatever it is given. */
  slug?: string;
  tags?: string[];
  confidence?: WikiConfidence;
  /** Say so when the workspace does not agree yet — lint surfaces it. */
  contested?: boolean;
  /** Ids of {@link WikiApi.ingestSource}d sources this page rests on. */
  sourceIds?: string[];
}

export interface WikiPageChanges {
  title?: string;
  type?: WikiPageType;
  summary?: string;
  body?: string;
  tags?: string[];
  confidence?: WikiConfidence;
  contested?: boolean;
  sourceIds?: string[];
}

export interface WikiSourceSpec {
  kind: WikiSourceKind;
  title: string;
  /** The material itself. Sources are immutable — changed text is a new one. */
  body: string;
  sourceUrl?: string;
}

export interface WikiCatalogFilter {
  type?: WikiPageType;
  status?: WikiPageStatus;
  /** Slugified server-side, so "Kho hàng" and `kho-hang` find the same tag. */
  tag?: string;
}

export interface WikiSettingsChanges {
  /** What this wiki is about — the frame every page is written inside. */
  domain?: string;
  /** House style: how a page is written, what it must cite, what it may not say. */
  conventions?: string;
  /** The tags a page may carry. Lint reports anything outside it. */
  taxonomy?: string[];
}

export interface WaitForIndexOptions {
  /** Give up after this long. Indexing continues. Default 120 000 ms. */
  timeoutMs?: number;
  /** Gap between polls. Default 2 000 ms. */
  intervalMs?: number;
}

function assertPageFields(
  fields: Partial<WikiPageSpec & WikiPageChanges>,
): void {
  if (fields.type !== undefined && !WIKI_PAGE_TYPES.includes(fields.type)) {
    throw new WikiPageError(
      "type",
      `"${fields.type}" is not one of ${WIKI_PAGE_TYPES.join(", ")}`,
    );
  }
  if (
    fields.confidence !== undefined &&
    !WIKI_CONFIDENCE_LEVELS.includes(fields.confidence)
  ) {
    throw new WikiPageError(
      "confidence",
      `"${fields.confidence}" is not one of ${WIKI_CONFIDENCE_LEVELS.join(", ")}`,
    );
  }
  if (fields.summary !== undefined) {
    if (fields.summary.trim() === "") {
      throw new WikiPageError(
        "summary",
        "it is what the catalog shows — a page needs one",
      );
    }
    if (fields.summary.length > MAX_WIKI_SUMMARY_LENGTH) {
      throw new WikiPageError(
        "summary",
        `${fields.summary.length} characters, but at most ` +
          `${MAX_WIKI_SUMMARY_LENGTH} are stored — it is one line, not the page`,
      );
    }
  }
  if (fields.body !== undefined && fields.body.length > MAX_WIKI_BODY_LENGTH) {
    throw new WikiPageError(
      "body",
      `${fields.body.length} characters, but at most ${MAX_WIKI_BODY_LENGTH} ` +
        "are stored — split it into linked pages",
    );
  }
  if (fields.tags && fields.tags.length > MAX_WIKI_TAGS) {
    throw new WikiPageError(
      "tags",
      `${fields.tags.length} tags, but at most ${MAX_WIKI_TAGS} are stored`,
    );
  }
  if (fields.sourceIds && fields.sourceIds.length > MAX_WIKI_PAGE_SOURCES) {
    throw new WikiPageError(
      "sourceIds",
      `${fields.sourceIds.length} sources, but a page cites at most ` +
        `${MAX_WIKI_PAGE_SOURCES}`,
    );
  }
}

/**
 * `client.wiki` — the workspace's knowledge base: pages people (and agents)
 * write, the sources those pages cite, and retrieval over the documents
 * attached to them.
 *
 * Three things it is worth knowing before writing against it.
 *
 * **A page is addressed by slug, never by title.** The slug is folded from the
 * title once, at creation, and stays put when the title changes —
 * {@link wikiSlug} predicts it, {@link search} finds one.
 *
 * **A page is written, then published.** Everything lands as `draft`,
 * including every edit to a published page, so nothing the workspace relies on
 * changes without someone saying so. Publishing takes `wiki:manage`, as does
 * setting the conventions; writing a draft takes `wiki:create`/`wiki:update`.
 * A mini app's service account is a `writer`, which reads the wiki and writes
 * nothing — reading is the floor, authoring is a decision.
 *
 * **Two kinds of provenance, and they are not interchangeable.** A *source* is
 * text ingested into the wiki and cited by a page. An *attachment* is a drive
 * file copied into the wiki and indexed, so {@link ask} can retrieve the
 * passages of it that answer a question — the RAG half. Attaching hands the
 * document to everyone who may read the wiki: the file's own sharing stops
 * applying at that moment.
 *
 * The wiki has no dry run on the server. Pages are definitions rather than
 * records, so writes execute in `development` mode too — except
 * {@link deletePage}, which is not reversible and refuses.
 */
export class WikiApi {
  constructor(
    private readonly http: Http,
    private readonly options: WriteOptions = {},
  ) {}

  // --------------------------------------------------------------- settings

  /** The domain, the conventions and the tag taxonomy pages are held to. */
  async settings(): Promise<WikiSettingsDto> {
    return this.http.request<WikiSettingsDto>("GET", "/ai-wiki/settings");
  }

  /**
   * Sets them. Takes `wiki:manage` — the conventions say how every page is
   * written, so changing them is not the permission that wrote one.
   */
  async setSettings(changes: WikiSettingsChanges): Promise<WikiSettingsDto> {
    return this.http.request<WikiSettingsDto>("PUT", "/ai-wiki/settings", {
      body: changes,
    });
  }

  // ------------------------------------------------------------------ pages

  /**
   * Every page grouped by type, each with its one-line summary. Generated per
   * request, so it cannot fall out of step with the pages themselves — this is
   * what to read first when answering a question from the wiki.
   */
  async catalog(filter: WikiCatalogFilter = {}): Promise<WikiCatalogDto> {
    return this.http.request<WikiCatalogDto>("GET", "/ai-wiki/pages", {
      query: { type: filter.type, status: filter.status, tag: filter.tag },
    });
  }

  /** Full-text search over titles, summaries and bodies. At most 50 matches. */
  async search(
    text: string,
    options: { limit?: number } = {},
  ): Promise<WikiPageMatchDto[]> {
    return (
      (await this.http.request<WikiPageMatchDto[]>("GET", "/ai-wiki/search", {
        query: { q: text, limit: options.limit },
      })) ?? []
    );
  }

  /**
   * One page with its body, its sources and both link directions. Takes the
   * slug — a title is folded to one on the way, so a page whose slug is the
   * plain fold of its title answers to either.
   */
  async page(slug: string): Promise<WikiPageDetailDto> {
    try {
      return await this.http.request<WikiPageDetailDto>(
        "GET",
        `/ai-wiki/pages/${encodeURIComponent(slug)}`,
      );
    } catch (error) {
      if (error instanceof ErpApiError && error.status === 404) {
        throw new UnknownWikiPageError(slug);
      }
      throw error;
    }
  }

  /** The page, or `undefined` where absence is ordinary. */
  async findPage(slug: string): Promise<WikiPageDetailDto | undefined> {
    try {
      return await this.page(slug);
    } catch (error) {
      if (error instanceof UnknownWikiPageError) return undefined;
      throw error;
    }
  }

  /** A page-scoped handle: update, publish, attach documents, ask them. */
  async handle(slug: string): Promise<WikiPageHandle> {
    return new WikiPageHandle(this, await this.page(slug));
  }

  /**
   * Creates a page. It lands as a **draft** whatever else is true — publishing
   * is its own call, and its own permission.
   *
   * ```ts
   * const page = await erp.wiki.createPage({
   *   title: "Chính sách tồn kho",
   *   type: "concept",
   *   summary: "Mức tồn tối thiểu theo nhóm hàng và ai được duyệt vượt mức.",
   *   body: "Xem thêm [[quy-trinh-nhap-kho]].",
   *   tags: ["kho"],
   * });
   * page.slug; // "chinh-sach-ton-kho" — the address from here on
   * ```
   */
  async createPage(spec: WikiPageSpec): Promise<WikiPageDto> {
    assertPageFields(spec);
    if (spec.title.trim() === "") {
      throw new WikiPageError(
        "title",
        "a page needs a title to be addressed by",
      );
    }
    return this.http.request<WikiPageDto>("POST", "/ai-wiki/pages", {
      body: {
        slug: spec.slug,
        title: spec.title,
        type: spec.type,
        summary: spec.summary,
        body: spec.body ?? "",
        tags: spec.tags ?? [],
        confidence: spec.confidence,
        contested: spec.contested ?? false,
        sourceIds: spec.sourceIds ?? [],
      },
    });
  }

  /**
   * Changes only the fields it carries — and returns a **published page to
   * draft**, so changing what the workspace relies on asks for the decision
   * again. The slug never moves.
   */
  async updatePage(
    slug: string,
    changes: WikiPageChanges,
  ): Promise<WikiPageDto> {
    assertPageFields(changes);
    if (Object.keys(changes).length === 0) {
      throw new WikiPageError(
        "update",
        `"${slug}" was updated with no changes`,
      );
    }
    return this.pageCall<WikiPageDto>(
      "PUT",
      `/ai-wiki/pages/${encodeURIComponent(slug)}`,
      slug,
      { body: changes },
    );
  }

  /** Marks a draft as something the workspace may rely on. Takes `wiki:manage`. */
  async publishPage(slug: string): Promise<WikiPageDto> {
    return this.pageCall<WikiPageDto>(
      "POST",
      `/ai-wiki/pages/${encodeURIComponent(slug)}/publish`,
      slug,
    );
  }

  /** Retires a page superseded by another, without breaking what links to it. */
  async archivePage(slug: string): Promise<WikiPageDto> {
    return this.pageCall<WikiPageDto>(
      "POST",
      `/ai-wiki/pages/${encodeURIComponent(slug)}/archive`,
      slug,
    );
  }

  /**
   * Removes the page. Links pointing at it survive as **broken** links, which
   * {@link lint} then reports — {@link archivePage} is usually what was meant.
   * Not reversible, so it refuses in development mode.
   */
  async deletePage(slug: string, options: WriteOptions = {}): Promise<void> {
    if (options.dryRun ?? this.options.dryRun ?? false) {
      throw new DryRunUnsupportedError(`deleting wiki page "${slug}"`);
    }
    await this.pageCall<unknown>(
      "DELETE",
      `/ai-wiki/pages/${encodeURIComponent(slug)}`,
      slug,
    );
  }

  // ---------------------------------------------------------------- sources

  /** One page of ingested sources, newest first. Bodies are omitted. */
  async sources(
    options: { page?: number; perPage?: number } = {},
  ): Promise<{ sources: WikiSourceDto[]; meta?: PageMeta }> {
    const paged = await this.http.requestPaged<WikiSourceDto[]>(
      "GET",
      "/ai-wiki/sources",
      { query: { page: options.page, perPage: options.perPage } },
    );
    return { sources: paged.data ?? [], meta: paged.meta };
  }

  /** One source with its body and the pages compiled from it. */
  async source(sourceId: string): Promise<WikiSourceDetailDto> {
    return this.http.request<WikiSourceDetailDto>(
      "GET",
      `/ai-wiki/sources/${sourceId}`,
    );
  }

  /**
   * Stores raw material a page will cite. Sources are **immutable**:
   * re-ingesting changed content creates a new one, which is what makes a
   * citation stable.
   */
  async ingestSource(spec: WikiSourceSpec): Promise<WikiSourceDto> {
    if (!WIKI_SOURCE_KINDS.includes(spec.kind)) {
      throw new WikiPageError(
        "source kind",
        `"${spec.kind}" is not one of ${WIKI_SOURCE_KINDS.join(", ")}`,
      );
    }
    if (spec.body.length > MAX_WIKI_SOURCE_BODY_LENGTH) {
      throw new WikiPageError(
        "source body",
        `${spec.body.length} characters, but at most ` +
          `${MAX_WIKI_SOURCE_BODY_LENGTH} are stored`,
      );
    }
    return this.http.request<WikiSourceDto>("POST", "/ai-wiki/sources", {
      body: {
        kind: spec.kind,
        title: spec.title,
        body: spec.body,
        sourceUrl: spec.sourceUrl,
      },
    });
  }

  // ----------------------------------------------------- attachments & RAG

  /**
   * Copies a drive file into the wiki and queues it for indexing, so
   * {@link ask} can retrieve what it says. Answers 202 — the copy exists,
   * its passages do not yet: poll {@link waitForIndex}.
   *
   * **The copy belongs to the wiki from here on.** The file's own sharing
   * stops applying, so everyone who may read this wiki may ask about what the
   * document says. The caller must be able to read the file themselves.
   */
  async attachFile(slug: string, fileId: string): Promise<WikiSourceDto> {
    return this.pageCall<WikiSourceDto>(
      "POST",
      `/ai-wiki/pages/${encodeURIComponent(slug)}/attachments`,
      slug,
      { body: { fileId } },
    );
  }

  /**
   * Unlinks the copy. A copy no page points at any more is deleted along with
   * its passages and extracted images.
   */
  async detachFile(slug: string, sourceId: string): Promise<void> {
    await this.pageCall<unknown>(
      "DELETE",
      `/ai-wiki/pages/${encodeURIComponent(slug)}/attachments/${sourceId}`,
      slug,
    );
  }

  /**
   * Retrieval over **this page's attached documents and no further**: the
   * passages that answer the question, matched by meaning and by wording
   * together, each carrying the source to cite and a link back to it.
   *
   * It retrieves; it does not write an answer. What comes back is the context
   * a model is given, or the quotes a person reads:
   *
   * ```ts
   * const passages = await erp.wiki.ask("chinh-sach-ton-kho", "Mức tồn tối thiểu nhóm A?");
   * for (const p of passages) console.log(`${p.source}: ${p.text}`);
   * ```
   *
   * 503 means the indexer or the embedding model is unavailable, not that the
   * page has nothing to say. A page whose attachments are still `pending` has
   * nothing to retrieve yet.
   */
  async ask(
    slug: string,
    query: string,
    options: { limit?: number } = {},
  ): Promise<WikiPassageDto[]> {
    if (options.limit !== undefined && options.limit > MAX_WIKI_ASK_PASSAGES) {
      throw new WikiPageError(
        "ask limit",
        `${options.limit} passages, but at most ${MAX_WIKI_ASK_PASSAGES} are returned`,
      );
    }
    return (
      (await this.pageCall<WikiPassageDto[]>(
        "POST",
        `/ai-wiki/pages/${encodeURIComponent(slug)}/ask`,
        slug,
        { body: { query, limit: options.limit } },
      )) ?? []
    );
  }

  /**
   * Polls a source until it is indexed. Returns it whatever it settles as —
   * `failed` carries `indexError`, and a document that fails to index is one
   * {@link ask} will never find. Timing out does not stop the indexing.
   */
  async waitForIndex(
    sourceId: string,
    options: WaitForIndexOptions = {},
  ): Promise<WikiSourceDto> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_INDEX_TIMEOUT_MS;
    const intervalMs = options.intervalMs ?? DEFAULT_INDEX_POLL_MS;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const source = await this.source(sourceId);
      const status = source.indexStatus ?? "";
      if (!WIKI_INDEX_PENDING_STATUSES.includes(status)) return source;
      if (Date.now() >= deadline) return source;
      await sleep(intervalMs);
    }
  }

  // ------------------------------------------------------------------ audit

  /**
   * Audits the whole wiki: broken links, orphans, contested and stale pages,
   * thin provenance, tags outside the taxonomy. Takes `wiki:update` rather
   * than read — it stamps `lintedAt` and appends to the log.
   */
  async lint(): Promise<WikiLintReportDto> {
    return this.http.request<WikiLintReportDto>("POST", "/ai-wiki/lint");
  }

  /** The append-only record of every wiki action, newest first. */
  async log(
    options: { page?: number; perPage?: number } = {},
  ): Promise<{ entries: WikiLogEntryDto[]; meta?: PageMeta }> {
    const paged = await this.http.requestPaged<WikiLogEntryDto[]>(
      "GET",
      "/ai-wiki/log",
      { query: { page: options.page, perPage: options.perPage } },
    );
    return { entries: paged.data ?? [], meta: paged.meta };
  }

  /** Every page call answers 404 the same way — as a slug that is not there. */
  private async pageCall<T>(
    method: string,
    path: string,
    slug: string,
    options: { body?: unknown } = {},
  ): Promise<T> {
    try {
      return await this.http.request<T>(method, path, options);
    } catch (error) {
      if (error instanceof ErpApiError && error.status === 404) {
        throw new UnknownWikiPageError(slug);
      }
      throw error;
    }
  }
}

/** One wiki page: its content, its provenance, and retrieval over its files. */
export class WikiPageHandle {
  constructor(
    private readonly wiki: WikiApi,
    private dto: WikiPageDetailDto,
  ) {}

  /** The address — stable across renames. */
  get slug(): string {
    return this.dto.slug;
  }

  get title(): string {
    return this.dto.title;
  }

  get status(): WikiPageStatus {
    return this.dto.status;
  }

  get isPublished(): boolean {
    return this.dto.status === "published";
  }

  get body(): string {
    return this.dto.body;
  }

  /** Sources cited plus documents attached — `fileId` tells them apart. */
  get sources(): WikiSourceDto[] {
    return this.dto.sources;
  }

  /** The page as the server last returned it, links included. */
  get meta(): WikiPageDetailDto {
    return this.dto;
  }

  /** Links out of this page that point at nothing. Lint reports these too. */
  get brokenLinks(): string[] {
    return this.dto.outbound.filter((l) => !l.resolved).map((l) => l.slug);
  }

  async refresh(): Promise<WikiPageDetailDto> {
    this.dto = await this.wiki.page(this.slug);
    return this.dto;
  }

  /** Edits the page — and returns it to draft if it was published. */
  async update(changes: WikiPageChanges): Promise<WikiPageDetailDto> {
    await this.wiki.updatePage(this.slug, changes);
    return this.refresh();
  }

  async publish(): Promise<WikiPageDetailDto> {
    await this.wiki.publishPage(this.slug);
    return this.refresh();
  }

  async archive(): Promise<WikiPageDetailDto> {
    await this.wiki.archivePage(this.slug);
    return this.refresh();
  }

  async delete(options: WriteOptions = {}): Promise<void> {
    await this.wiki.deletePage(this.slug, options);
  }

  /** {@link WikiApi.attachFile} on this page. */
  async attach(fileId: string): Promise<WikiSourceDto> {
    const source = await this.wiki.attachFile(this.slug, fileId);
    await this.refresh();
    return source;
  }

  async detach(sourceId: string): Promise<void> {
    await this.wiki.detachFile(this.slug, sourceId);
    await this.refresh();
  }

  /** {@link WikiApi.ask} scoped to this page's attached documents. */
  async ask(
    query: string,
    options: { limit?: number } = {},
  ): Promise<WikiPassageDto[]> {
    return this.wiki.ask(this.slug, query, options);
  }
}
