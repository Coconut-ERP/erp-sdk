import { describe, expect, it } from "vitest";
import {
  DryRunUnsupportedError,
  ErpApiError,
  UnknownWikiPageError,
  WikiPageError,
} from "../src/errors";
import type { WikiPageDetailDto, WikiPageDto } from "../src/types";
import { WikiApi, wikiSlug } from "../src/wiki";
import { FakeHttp } from "./helpers/http";

function page(overrides: Partial<WikiPageDto> = {}): WikiPageDto {
  return {
    id: "page-1",
    workspaceId: "ws-1",
    slug: "chinh-sach-ton-kho",
    title: "Chính sách tồn kho",
    type: "concept",
    summary: "Mức tồn tối thiểu theo nhóm hàng.",
    tags: ["kho"],
    contested: false,
    status: "draft",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

function detail(overrides: Partial<WikiPageDetailDto> = {}): WikiPageDetailDto {
  return {
    ...page(),
    body: "Xem [[quy-trinh-nhap-kho]].",
    sources: [],
    outbound: [{ slug: "quy-trinh-nhap-kho", resolved: false }],
    inbound: [],
    ...overrides,
  };
}

describe("wikiSlug", () => {
  it("folds Vietnamese accents instead of dropping them", () => {
    expect(wikiSlug("Hoá đơn bán hàng")).toBe("hoa-don-ban-hang");
    expect(wikiSlug("Hồ sơ")).toBe("ho-so");
    expect(wikiSlug("  Chính sách — tồn kho!  ")).toBe("chinh-sach-ton-kho");
    expect(wikiSlug("Đơn hàng 2026")).toBe("don-hang-2026");
    expect(wikiSlug("!!!")).toBe("");
  });
});

describe("pages", () => {
  it("creates a draft with the caps the server enforces", async () => {
    const http = new FakeHttp({ "POST /ai-wiki/pages": [page()] });
    const wiki = new WikiApi(http);

    const created = await wiki.createPage({
      title: "Chính sách tồn kho",
      type: "concept",
      summary: "Mức tồn tối thiểu theo nhóm hàng.",
      tags: ["kho"],
    });

    expect(created.slug).toBe("chinh-sach-ton-kho");
    expect(http.body(0)).toMatchObject({
      title: "Chính sách tồn kho",
      type: "concept",
      contested: false,
      sourceIds: [],
    });
  });

  it("refuses a type or a summary the server would refuse", async () => {
    const wiki = new WikiApi(new FakeHttp({}));

    await expect(
      wiki.createPage({
        title: "X",
        // biome-ignore lint/suspicious/noExplicitAny: testing a wrong enum
        type: "howto" as any,
        summary: "s",
      }),
    ).rejects.toBeInstanceOf(WikiPageError);

    await expect(
      wiki.createPage({
        title: "X",
        type: "concept",
        summary: "s".repeat(501),
      }),
    ).rejects.toBeInstanceOf(WikiPageError);

    await expect(wiki.updatePage("chinh-sach-ton-kho", {})).rejects.toThrow(
      /no changes/,
    );
  });

  it("turns a 404 into an error that says slugs are the address", async () => {
    const http = new FakeHttp({
      "GET /ai-wiki/pages/khong-co": [new ErpApiError(404, "Page not found")],
    });
    const wiki = new WikiApi(http);

    await expect(wiki.page("khong-co")).rejects.toBeInstanceOf(
      UnknownWikiPageError,
    );
    expect(await wiki.findPage("khong-co")).toBeUndefined();
  });

  it("refuses to delete a page during a rehearsal", async () => {
    const wiki = new WikiApi(new FakeHttp({}), { dryRun: true });
    await expect(wiki.deletePage("chinh-sach-ton-kho")).rejects.toBeInstanceOf(
      DryRunUnsupportedError,
    );
  });
});

describe("page handle", () => {
  it("reports broken links and re-reads after publishing", async () => {
    const http = new FakeHttp({
      "GET /ai-wiki/pages/chinh-sach-ton-kho": [
        detail(),
        detail({ status: "published" }),
      ],
      "POST /ai-wiki/pages/chinh-sach-ton-kho/publish": [
        page({ status: "published" }),
      ],
    });
    const wiki = new WikiApi(http);

    const handle = await wiki.handle("chinh-sach-ton-kho");
    expect(handle.brokenLinks).toEqual(["quy-trinh-nhap-kho"]);
    expect(handle.isPublished).toBe(false);

    await handle.publish();
    expect(handle.isPublished).toBe(true);
  });
});

describe("attachments and retrieval", () => {
  it("asks inside one page's documents", async () => {
    const http = new FakeHttp({
      "POST /ai-wiki/pages/chinh-sach-ton-kho/ask": [
        [
          {
            kind: "text",
            text: "Nhóm A giữ tồn tối thiểu 30 ngày.",
            source: "Quy chế kho 2026",
            sourceId: "src-1",
            score: 0.82,
          },
        ],
      ],
    });
    const wiki = new WikiApi(http);

    const passages = await wiki.ask("chinh-sach-ton-kho", "Tồn tối thiểu?", {
      limit: 5,
    });
    expect(passages[0]?.source).toBe("Quy chế kho 2026");
    expect(http.body(0)).toEqual({ query: "Tồn tối thiểu?", limit: 5 });

    await expect(
      wiki.ask("chinh-sach-ton-kho", "x", { limit: 50 }),
    ).rejects.toBeInstanceOf(WikiPageError);
  });

  it("waits for an attached document to finish indexing", async () => {
    const http = new FakeHttp({
      "GET /ai-wiki/sources/src-1": [
        { id: "src-1", indexStatus: "pending" },
        { id: "src-1", indexStatus: "ready" },
      ],
    });
    const wiki = new WikiApi(http);

    const source = await wiki.waitForIndex("src-1", { intervalMs: 1 });
    expect(source.indexStatus).toBe("ready");
  });

  it("returns a failed document rather than hanging on it", async () => {
    const http = new FakeHttp({
      "GET /ai-wiki/sources/src-2": [
        {
          id: "src-2",
          indexStatus: "failed",
          indexError: "unsupported format",
        },
      ],
    });
    const source = await new WikiApi(http).waitForIndex("src-2", {
      intervalMs: 1,
    });
    expect(source.indexError).toBe("unsupported format");
  });
});
