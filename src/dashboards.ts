import {
  SqlQueryError,
  UnknownDashboardError,
  UnknownQueryError,
} from "./errors";
import { DataFrame, type Row } from "./frame";
import type { Http } from "./http";
import type {
  ChartType,
  DashboardDto,
  DashboardQueryDto,
  PageMeta,
  QueryParamSpec,
  QueryResultDto,
  SharingDto,
  SharingEntry,
  SharingVisibility,
} from "./types";

/** The server cuts every result here and sets `truncated` — aggregate in SQL. */
export const MAX_QUERY_ROWS = 1000;

/** Server cap on declared `@name` parameters per query. */
export const MAX_QUERY_PARAMS = 20;

/** Columns every compiled object CTE carries besides its fields. */
export const QUERY_SYSTEM_COLUMNS = ["id", "created_at", "updated_at"] as const;

/**
 * Bound by the server on every statement: the calling workspace's id. Use it
 * to scope a hand-written join instead of pasting a uuid in.
 */
export const WORKSPACE_ID_PARAM = "@workspace_id";

export const CHART_TYPES: readonly ChartType[] = [
  "table",
  "number",
  "line",
  "bar",
  "area",
  "pie",
  "composed",
  "scatter",
  "radar",
  "radial_bar",
  "funnel",
  "treemap",
  "sankey",
  "sunburst",
];

const COMMENTS = /--[^\n]*|\/\*[\s\S]*?\*\//g;
const STRINGS = /'(?:''|[^'])*'/g;

/**
 * Quotes a display name for SQL: `"Đơn hàng"`. Object and field names *are*
 * the identifiers here, and they hold spaces, diacritics and case that a bare
 * identifier would not survive.
 */
export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * The two rules the endpoint enforces before it ever touches the database:
 * one statement, and it has to be a `SELECT` (a leading `WITH` counts).
 * Checked here so a typo costs no round trip.
 */
export function assertSelectStatement(sql: string): void {
  const stripped = sql.replace(COMMENTS, " ").trim();
  if (stripped === "") {
    throw new SqlQueryError("the statement is empty");
  }
  if (!/^(select|with)\b/i.test(stripped)) {
    throw new SqlQueryError(
      `it must start with SELECT (or WITH), got "${stripped.split(/\s+/)[0]}" — ` +
        "the query runs in a read-only transaction, so no INSERT/UPDATE/DELETE/DDL",
    );
  }
  const withoutStrings = stripped.replace(STRINGS, "''");
  const semicolon = withoutStrings.indexOf(";");
  if (semicolon >= 0 && withoutStrings.slice(semicolon + 1).trim() !== "") {
    throw new SqlQueryError("only one statement runs — remove everything after the ;");
  }
}

export interface SqlOptions {
  /** Declares the `@name` placeholders the SQL uses. */
  params?: QueryParamSpec[];
  /** Values for those placeholders; a missing one falls back to its default. */
  values?: Record<string, unknown>;
}

export interface QuerySpec {
  name: string;
  sql: string;
  params?: QueryParamSpec[];
  chartType?: ChartType;
  chartConfig?: Record<string, unknown>;
}

export type QueryChanges = Partial<QuerySpec>;

/**
 * Columns and rows from one query run. Rows are already flat objects keyed by
 * the column names the SQL declared, so {@link toFrame} needs no mapping.
 */
export class QueryResult implements QueryResultDto {
  constructor(
    readonly columns: string[],
    readonly rows: Row[],
    readonly rowCount: number,
    /** `true` when the server cut the result at {@link MAX_QUERY_ROWS}. */
    readonly truncated: boolean,
    /** The SQL actually run, with each object name expanded into a CTE. */
    readonly compiledSql?: string,
  ) {}

  static from(dto: QueryResultDto): QueryResult {
    return new QueryResult(
      dto.columns ?? [],
      (dto.rows ?? []) as Row[],
      dto.rowCount ?? dto.rows?.length ?? 0,
      dto.truncated ?? false,
      dto.compiledSql,
    );
  }

  toArray(): Row[] {
    return this.rows;
  }

  toFrame(): DataFrame<Row> {
    return DataFrame.from(this.rows);
  }

  /** Every value of one column, in row order. */
  column<T = unknown>(name: string): T[] {
    return this.rows.map((row) => row[name] as T);
  }

  /**
   * The single value a scalar query returns — first row, first column unless
   * a name is given. `undefined` when nothing matched.
   */
  value<T = unknown>(column?: string): T | undefined {
    const row = this.rows[0];
    if (!row) return undefined;
    const key = column ?? this.columns[0];
    return key === undefined ? undefined : (row[key] as T);
  }
}

export interface ListDashboardsOptions {
  page?: number;
  perPage?: number;
}

/**
 * `client.dashboards` — saved SQL over the workspace, grouped into dashboards.
 *
 * The SQL addresses **display names**: an object is a table
 * (`FROM "Đơn hàng"`), a field is a column (`"Tổng tiền"`), and every object
 * also carries `id`, `created_at`, `updated_at`. It runs read-only, row-scoped
 * by the caller's record permissions, and capped at {@link MAX_QUERY_ROWS} rows.
 */
export class DashboardsApi {
  constructor(private readonly http: Http) {}

  /**
   * One page, newest first, with the envelope's page counts. The server
   * paginates *before* it filters by sharing, so a short page is normal and
   * says nothing about the end — read `meta.totalPages`, or use
   * {@link listAll}.
   */
  async list(
    options: ListDashboardsOptions = {},
  ): Promise<{ dashboards: DashboardDto[]; meta?: PageMeta }> {
    const query = { page: options.page, perPage: options.perPage };
    if (this.http.requestPaged) {
      const paged = await this.http.requestPaged<DashboardDto[]>(
        "GET",
        "/dashboards",
        { query },
      );
      return { dashboards: paged.data ?? [], meta: paged.meta };
    }
    const dashboards = await this.http.request<DashboardDto[]>("GET", "/dashboards", {
      query,
    });
    return { dashboards: dashboards ?? [] };
  }

  /** Every dashboard the caller may see, walking `meta.totalPages`. */
  async listAll(options: { perPage?: number } = {}): Promise<DashboardDto[]> {
    const perPage = options.perPage ?? 100;
    const first = await this.list({ page: 1, perPage });
    const all = [...first.dashboards];
    const pages = first.meta?.totalPages ?? 1;
    for (let page = 2; page <= pages; page++) {
      all.push(...(await this.list({ page, perPage })).dashboards);
    }
    return all;
  }

  /** The dashboard with its queries, by id. */
  async get(dashboardId: string): Promise<DashboardDto> {
    return this.http.request<DashboardDto>("GET", `/dashboards/${dashboardId}`);
  }

  async create(spec: { name: string; description?: string }): Promise<DashboardHandle> {
    const dto = await this.http.request<DashboardDto>("POST", "/dashboards", {
      body: { name: spec.name, description: spec.description },
    });
    return new DashboardHandle(this.http, dto);
  }

  /** Resolves by id, then exact name, then case-insensitive name. */
  async handle(nameOrId: string): Promise<DashboardHandle> {
    const dashboards = await this.listAll();
    const found =
      dashboards.find((d) => d.id === nameOrId) ??
      dashboards.find((d) => d.name === nameOrId) ??
      dashboards.find((d) => d.name.toLowerCase() === nameOrId.toLowerCase());
    if (!found) {
      throw new UnknownDashboardError(
        nameOrId,
        dashboards.map((d) => d.name),
      );
    }
    return new DashboardHandle(this.http, await this.get(found.id));
  }

  /**
   * Runs SQL without saving it (`POST /dashboards/queries/preview`) — the
   * ad-hoc half of this API, and the one worth reaching for when a report is
   * a `GROUP BY` the record query cannot express.
   */
  async sql(sql: string, options: SqlOptions = {}): Promise<QueryResult> {
    assertSelectStatement(sql);
    const dto = await this.http.request<QueryResultDto>(
      "POST",
      "/dashboards/queries/preview",
      { body: { sql, params: options.params, values: options.values } },
    );
    return QueryResult.from(dto);
  }
}

/** One dashboard and the saved queries on it. */
export class DashboardHandle {
  private queryCache?: DashboardQueryDto[];

  constructor(
    private readonly http: Http,
    private dto: DashboardDto,
  ) {
    this.queryCache = dto.queries;
  }

  get id(): string {
    return this.dto.id;
  }

  get name(): string {
    return this.dto.name;
  }

  get meta(): DashboardDto {
    return this.dto;
  }

  async refresh(): Promise<DashboardDto> {
    this.dto = await this.http.request<DashboardDto>("GET", `/dashboards/${this.id}`);
    this.queryCache = this.dto.queries;
    return this.dto;
  }

  async update(changes: { name?: string; description?: string }): Promise<DashboardDto> {
    this.dto = await this.http.request<DashboardDto>("PUT", `/dashboards/${this.id}`, {
      body: changes,
    });
    return this.dto;
  }

  /** Deletes the dashboard **and every query on it**. */
  async delete(): Promise<void> {
    await this.http.request<unknown>("DELETE", `/dashboards/${this.id}`);
  }

  async queries(refresh = false): Promise<DashboardQueryDto[]> {
    if (!this.queryCache || refresh) {
      this.queryCache = await this.http.request<DashboardQueryDto[]>(
        "GET",
        `/dashboards/${this.id}/queries`,
      );
    }
    return this.queryCache ?? [];
  }

  /** Resolves a query by id, then exact name, then case-insensitive name. */
  async query(nameOrId: string): Promise<DashboardQueryDto> {
    const queries = await this.queries();
    const found =
      queries.find((q) => q.id === nameOrId) ??
      queries.find((q) => q.name === nameOrId) ??
      queries.find((q) => q.name.toLowerCase() === nameOrId.toLowerCase());
    if (!found) {
      throw new UnknownQueryError(
        nameOrId,
        this.name,
        queries.map((q) => q.name),
      );
    }
    return found;
  }

  async addQuery(spec: QuerySpec): Promise<DashboardQueryDto> {
    assertSelectStatement(spec.sql);
    const created = await this.http.request<DashboardQueryDto>(
      "POST",
      `/dashboards/${this.id}/queries`,
      {
        body: {
          name: spec.name,
          sql: spec.sql,
          params: spec.params,
          chartType: spec.chartType,
          chartConfig: spec.chartConfig,
        },
      },
    );
    this.queryCache = undefined;
    return created;
  }

  async updateQuery(
    nameOrId: string,
    changes: QueryChanges,
  ): Promise<DashboardQueryDto> {
    if (changes.sql !== undefined) assertSelectStatement(changes.sql);
    const target = await this.query(nameOrId);
    const updated = await this.http.request<DashboardQueryDto>(
      "PUT",
      `/dashboards/${this.id}/queries/${target.id}`,
      { body: changes },
    );
    this.queryCache = undefined;
    return updated;
  }

  async deleteQuery(nameOrId: string): Promise<void> {
    const target = await this.query(nameOrId);
    await this.http.request<unknown>(
      "DELETE",
      `/dashboards/${this.id}/queries/${target.id}`,
    );
    this.queryCache = undefined;
  }

  /**
   * Runs a saved query. `params` supplies values for its declared `@name`
   * placeholders; one left out runs with its default. Read-only, so this is
   * never a dry run.
   */
  async run(
    nameOrId: string,
    params: Record<string, unknown> = {},
  ): Promise<QueryResult> {
    const target = await this.query(nameOrId);
    const dto = await this.http.request<QueryResultDto>(
      "POST",
      `/dashboards/${this.id}/queries/${target.id}/run`,
      { body: { params } },
    );
    return QueryResult.from(dto);
  }

  /** {@link run} straight into a {@link DataFrame}. */
  async toFrame(
    nameOrId: string,
    params: Record<string, unknown> = {},
  ): Promise<DataFrame<Row>> {
    return (await this.run(nameOrId, params)).toFrame();
  }

  async sharing(): Promise<SharingDto> {
    return this.http.request<SharingDto>("GET", `/dashboards/${this.id}/acl`);
  }

  /** Entries are only accepted with `restricted` visibility. */
  async setSharing(
    visibility: SharingVisibility,
    entries: SharingEntry[] = [],
  ): Promise<SharingDto> {
    return this.http.request<SharingDto>("PUT", `/dashboards/${this.id}/acl`, {
      body: { visibility, entries },
    });
  }
}
