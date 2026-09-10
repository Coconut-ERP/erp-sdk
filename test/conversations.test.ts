import { describe, expect, it } from "vitest";
import { ConversationsApi } from "../src/conversations";
import type { ConversationDto } from "../src/types";
import { FakeHttp } from "./helpers/http";

function conversation(
  overrides: Partial<ConversationDto> = {},
): ConversationDto {
  return {
    id: "conv-1",
    title: "Tổng hợp đơn hôm qua",
    hidden: true,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("ConversationsApi", () => {
  it("lists visible conversations by default and sends no visibility", async () => {
    const http = new FakeHttp({
      "GET /ai/conversations": [[conversation({ hidden: false })]],
    });

    const page = await new ConversationsApi(http).list();

    expect(page.conversations).toHaveLength(1);
    expect(http.calls[0]?.options.query).toEqual({
      visibility: undefined,
      page: undefined,
      perPage: undefined,
    });
  });

  it("asks for the hidden ones an agent workflow opened", async () => {
    const http = new FakeHttp({
      "GET /ai/conversations": [[conversation()]],
    });

    await new ConversationsApi(http).list({ visibility: "hidden" });

    expect(http.calls[0]?.options.query).toMatchObject({
      visibility: "hidden",
    });
  });

  it("walks every page reported by meta", async () => {
    const http = new FakeHttp(
      {
        "GET /ai/conversations": [
          [conversation({ id: "a" })],
          [conversation({ id: "b" })],
        ],
      },
      { page: 1, perPage: 1, totalItems: 2, totalPages: 2 },
    );

    const all = await new ConversationsApi(http).listAll({
      perPage: 1,
      visibility: "all",
    });

    expect(all.map((c) => c.id)).toEqual(["a", "b"]);
    expect(http.calls[1]?.options.query).toMatchObject({
      page: 2,
      visibility: "all",
    });
  });

  it("reads a hidden conversation by id, transcript and all", async () => {
    const http = new FakeHttp({
      "GET /ai/conversations/conv-1": [
        {
          ...conversation(),
          messages: [
            {
              id: "m-1",
              role: "assistant",
              content: "Đã ghi 12 dòng vào Báo cáo ngày.",
              steps: [],
              attachments: [],
              createdAt: "",
            },
          ],
          activeTurn: { id: "turn-1", status: "RUNNING" },
        },
      ],
    });

    const detail = await new ConversationsApi(http).get("conv-1");

    expect(detail.hidden).toBe(true);
    expect(detail.messages[0]?.content).toContain("Báo cáo ngày");
    expect(detail.activeTurn?.status).toBe("RUNNING");
  });
});
