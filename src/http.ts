import { ErpApiError } from "./errors";
import type { Envelope, PageMeta } from "./types";

export const API_KEY_PREFIX = "erp_sk_";

export interface HttpOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

/** A response body plus the envelope's `meta`, when the endpoint sends one. */
export interface Paged<T> {
  data: T;
  meta?: PageMeta;
}

export interface Http {
  request<T>(method: string, path: string, options?: HttpOptions): Promise<T>;
  /**
   * Same call, keeping the envelope's `meta` — the page counts that
   * `GET /dashboards` needs, because it paginates *before* it filters by
   * sharing, so a short page does not mean the last one. Optional so a test
   * double can implement `request` alone.
   */
  requestPaged?<T>(
    method: string,
    path: string,
    options?: HttpOptions,
  ): Promise<Paged<T>>;
}

export interface HttpConfig {
  baseUrl: string;
  apiKey?: string;
  accessToken?: string;
  workspaceId?: string;
  fetch?: typeof globalThis.fetch;
}

export class FetchHttp implements Http {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(private readonly config: HttpConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "") + "/api/v1";
    this.fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.apiKey) {
      headers["X-API-Key"] = this.config.apiKey;
    } else if (this.config.accessToken) {
      headers["Authorization"] = `Bearer ${this.config.accessToken}`;
    }
    if (this.config.workspaceId) {
      headers["X-Workspace-Id"] = this.config.workspaceId;
    }
    return headers;
  }

  async request<T>(
    method: string,
    path: string,
    options: HttpOptions = {},
  ): Promise<T> {
    return (await this.requestPaged<T>(method, path, options)).data;
  }

  async requestPaged<T>(
    method: string,
    path: string,
    options: HttpOptions = {},
  ): Promise<Paged<T>> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const response = await this.fetchImpl(url, {
      method,
      headers: this.headers(),
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const text = await response.text();
    let payload: (Partial<Envelope<T>> & { meta?: PageMeta }) | undefined;
    try {
      payload = text
        ? (JSON.parse(text) as Envelope<T> & { meta?: PageMeta })
        : undefined;
    } catch {
      payload = undefined;
    }

    if (!response.ok) {
      throw new ErpApiError(
        response.status,
        payload?.message ?? response.statusText,
        payload?.trace,
        payload?.data,
      );
    }

    return { data: payload?.data as T, meta: payload?.meta };
  }
}
