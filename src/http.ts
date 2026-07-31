import { ErpApiError } from "./errors";
import type { Envelope } from "./types";

export const API_KEY_PREFIX = "erp_sk_";

export interface HttpOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

export interface Http {
  request<T>(method: string, path: string, options?: HttpOptions): Promise<T>;
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
    let payload: Partial<Envelope<T>> | undefined;
    try {
      payload = text ? (JSON.parse(text) as Envelope<T>) : undefined;
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

    return payload?.data as T;
  }
}
