import type { Http } from "./http";
import type {
  ConversationDetailDto,
  ConversationDto,
  ConversationVisibility,
  PageMeta,
} from "./types";

export interface ConversationListOptions {
  visibility?: ConversationVisibility;
  page?: number;
  perPage?: number;
}

export class ConversationsApi {
  constructor(private readonly http: Http) {}

  async list(
    options: ConversationListOptions = {},
  ): Promise<{ conversations: ConversationDto[]; meta?: PageMeta }> {
    const paged = await this.http.requestPaged<ConversationDto[]>(
      "GET",
      "/ai/conversations",
      {
        query: {
          visibility: options.visibility,
          page: options.page,
          perPage: options.perPage,
        },
      },
    );
    return { conversations: paged.data ?? [], meta: paged.meta };
  }

  async listAll(
    options: { visibility?: ConversationVisibility; perPage?: number } = {},
  ): Promise<ConversationDto[]> {
    const perPage = options.perPage ?? 100;
    const first = await this.list({ ...options, page: 1, perPage });
    const all = [...first.conversations];
    const pages = first.meta?.totalPages ?? 1;
    for (let page = 2; page <= pages; page++) {
      all.push(
        ...(await this.list({ ...options, page, perPage })).conversations,
      );
    }
    return all;
  }

  async get(conversationId: string): Promise<ConversationDetailDto> {
    return this.http.request<ConversationDetailDto>(
      "GET",
      `/ai/conversations/${encodeURIComponent(conversationId)}`,
    );
  }
}
