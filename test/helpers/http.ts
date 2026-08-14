import type { Http, HttpOptions, Paged } from "../../src/http";
import type { PageMeta } from "../../src/types";

export interface Call {
  method: string;
  path: string;
  options: HttpOptions;
}

/**
 * The one HTTP double the SDK tests inject — no network anywhere in the suite.
 *
 * Responses are queued per `"METHOD /path"` and consumed in order; the last one
 * repeats once the queue runs dry, so a test lists one entry per *distinct*
 * reply rather than one per call. A path that was never registered throws: a
 * request the test did not plan for is a failure, not an empty result.
 */
export class FakeHttp implements Http {
  readonly calls: Call[] = [];

  constructor(
    private readonly responses: Record<string, unknown[]> = {},
    /** Envelope `meta`, for the endpoints that paginate by page number. */
    private readonly meta?: PageMeta,
  ) {}

  async request<T>(
    method: string,
    path: string,
    options: HttpOptions = {},
  ): Promise<T> {
    this.calls.push({ method, path, options });
    const queue = this.responses[`${method} ${path}`];
    if (!queue || queue.length === 0) {
      throw new Error(`Unexpected request: ${method} ${path}`);
    }
    return (queue.length === 1 ? queue[0] : queue.shift()) as T;
  }

  async requestPaged<T>(
    method: string,
    path: string,
    options?: HttpOptions,
  ): Promise<Paged<T>> {
    const data = await this.request<T>(method, path, options);
    return { data, meta: this.meta };
  }

  /** The JSON body the nth request carried. */
  body(index = 0): Record<string, unknown> {
    return (this.calls[index]?.options.body ?? {}) as Record<string, unknown>;
  }

  /** The bodies of every non-GET request, in order. */
  writeBodies(): Record<string, unknown>[] {
    return this.calls
      .filter((call) => call.method !== "GET")
      .map((call) => (call.options.body ?? {}) as Record<string, unknown>);
  }
}
