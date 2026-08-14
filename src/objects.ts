import {
  DryRunUnsupportedError,
  FilterValueError,
  RelationValueError,
  UnknownFieldError,
} from "./errors";
import { DataFrame, type Row } from "./frame";
import type { Http } from "./http";
import type {
  BulkCreateRecordsResult,
  BulkUpdateRecordsResult,
  FieldDto,
  FilterOperator,
  LinkDirection,
  ObjectDto,
  QueryRecordsRequest,
  RecordDto,
  RecordFilter,
  RecordPage,
  RecordPreload,
  RecordSort,
  SortDirection,
} from "./types";

const MAX_PAGE_SIZE = 100;

const MAX_BULK_CREATE = 500;

/**
 * The filter key that addresses a record's own id instead of a field. The
 * server compiles it against the primary key, so it takes `equals`,
 * `not_equals`, `in` and `not_in` and nothing else.
 */
export const RECORD_ID_FILTER_KEY = "id";

/** Server cap on how many values one `in`/`not_in` filter may carry. */
export const MAX_FILTER_VALUES = 200;

/**
 * Server cap on how many ids one relation field of one record may name in a
 * single write. Past it, the list is not editable inline at all — reading it
 * back is capped at 100 too — so long relations are edited link by link.
 */
export const MAX_RELATION_IDS = 100;

const MEMBERSHIP_OPERATORS: readonly FilterOperator[] = ["in", "not_in"];

/** {@link WriteOptions} plus the optimistic-lock version, for record updates. */
export type VersionedWriteOptions = WriteOptions & { version?: number };

function versionedOptions(
  options: number | VersionedWriteOptions,
): VersionedWriteOptions {
  return typeof options === "number" ? { version: options } : options;
}

/** Per-call escape hatch from the client's environment mode. */
export interface WriteOptions {
  /**
   * `true` validates everything and rolls back; `false` writes for real even
   * in development mode. Omitted, the client's mode decides.
   */
  dryRun?: boolean;
}

/**
 * A relation is written as the whole list, so the shapes that go wrong are
 * predictable: a bare id instead of an array, `RecordDto`s instead of their
 * ids, or a list longer than the server will take. All three are 400s worth
 * catching before the round trip, with the display name the caller wrote.
 */
function checkRelationValue(field: FieldDto, value: unknown): void {
  // null / absent both mean "say nothing about this relation" — never "clear".
  if (value === null || value === undefined) return;
  if (!Array.isArray(value)) {
    throw new RelationValueError(
      field.name,
      `expected an array of record ids, got ${typeof value}`,
    );
  }
  if (value.length > MAX_RELATION_IDS) {
    throw new RelationValueError(
      field.name,
      `names ${value.length} records, but one write carries at most ` +
        `${MAX_RELATION_IDS} per field — edit longer relations with ` +
        "createLink/deleteLink instead",
    );
  }
  for (const id of value) {
    if (typeof id === "string" && id.trim() !== "") continue;
    throw new RelationValueError(
      field.name,
      id && typeof id === "object" && "id" in (id as Record<string, unknown>)
        ? "got record objects — map them to ids first, e.g. rows.map((r) => r.id)"
        : `"${String(id)}" is not a record id`,
    );
  }
}

/**
 * `in`/`not_in` are the only operators whose value has a shape, and getting it
 * wrong is a 400 from the server — cheaper to say so here, with the field name
 * the caller actually wrote.
 */
function checkFilterValue(
  field: string,
  operator: FilterOperator,
  value: unknown,
): void {
  if (!MEMBERSHIP_OPERATORS.includes(operator)) return;
  if (!Array.isArray(value)) {
    throw new FilterValueError(field, operator, "needs an array of values");
  }
  if (value.length === 0) {
    throw new FilterValueError(field, operator, "needs at least one value");
  }
  if (value.length > MAX_FILTER_VALUES) {
    throw new FilterValueError(
      field,
      operator,
      `accepts at most ${MAX_FILTER_VALUES} values, got ${value.length} — split it into chunks`,
    );
  }
}

export class ObjectHandle {
  private readonly byKey = new Map<string, FieldDto>();
  private readonly byName = new Map<string, FieldDto>();

  /**
   * `options.dryRun` is the handle's default for every record write —
   * `ErpClient` sets it from the environment mode. Individual calls still
   * override it.
   */
  constructor(
    private readonly http: Http,
    readonly meta: ObjectDto,
    readonly fields: FieldDto[],
    private readonly options: WriteOptions = {},
  ) {
    for (const field of fields) {
      this.index(field);
    }
  }

  /** Whether writes through this handle are dry runs unless told otherwise. */
  get dryRun(): boolean {
    return this.options.dryRun ?? false;
  }

  private dryRunFor(options: WriteOptions): boolean {
    return options.dryRun ?? this.dryRun;
  }

  /**
   * `dryRun: false` is never sent — its absence is what the server reads as a
   * real write, and sending the key would be noise in every request body.
   */
  private writeFlag(options: WriteOptions): { dryRun?: true } {
    return this.dryRunFor(options) ? { dryRun: true } : {};
  }

  private refuseDryRun(operation: string, options: WriteOptions): void {
    if (this.dryRunFor(options)) throw new DryRunUnsupportedError(operation);
  }

  private index(field: FieldDto): void {
    this.byKey.set(field.key, field);
    this.byName.set(field.name.toLowerCase(), field);
  }

  get id(): string {
    return this.meta.id;
  }

  get name(): string {
    return this.meta.name;
  }

  /** Internal key first, then display name (case-insensitive) — the one lookup. */
  private lookup(nameOrKey: string): FieldDto | undefined {
    return (
      this.byKey.get(nameOrKey) ?? this.byName.get(nameOrKey.toLowerCase())
    );
  }

  field(nameOrKey: string): FieldDto {
    const field = this.lookup(nameOrKey);
    if (!field) {
      throw new UnknownFieldError(
        nameOrKey,
        this.meta.name,
        this.fields.map((f) => f.name),
      );
    }
    return field;
  }

  /** Whether this object carries the field, by internal key or display name. */
  hasField(nameOrKey: string): boolean {
    return this.lookup(nameOrKey) !== undefined;
  }

  fieldKey(nameOrKey: string): string {
    return this.field(nameOrKey).key;
  }

  /**
   * The key a *filter* addresses. Same resolution as `fieldKey`, plus one
   * fallback: the literal `id` means the record's own id, which is not an
   * `engine_fields` row and so resolves through nothing. A real field named
   * "id" still wins — the same order the backend resolves filter fields in.
   */
  filterKey(nameOrKey: string): string {
    const field = this.lookup(nameOrKey);
    if (field) return field.key;
    if (nameOrKey.trim().toLowerCase() === RECORD_ID_FILTER_KEY) {
      return RECORD_ID_FILTER_KEY;
    }
    return this.fieldKey(nameOrKey);
  }

  private resolveData(data: Row): Row {
    const resolved: Row = {};
    for (const [key, value] of Object.entries(data)) {
      const field = this.field(key);
      if (field.type === "relation") checkRelationValue(field, value);
      resolved[field.key] = value;
    }
    return resolved;
  }

  async rename(name: string): Promise<ObjectDto> {
    const updated = await this.http.request<ObjectDto>(
      "PUT",
      `/objects/${this.id}`,
      { body: { name } },
    );
    this.meta.name = updated.name;
    return updated;
  }

  async addField(
    name: string,
    type: string,
    options: { config?: Record<string, unknown>; position?: number } = {},
  ): Promise<FieldDto> {
    const field = await this.http.request<FieldDto>(
      "POST",
      `/objects/${this.id}/fields`,
      {
        body: {
          name,
          type,
          config: options.config ?? {},
          position: options.position ?? this.fields.length,
        },
      },
    );
    this.fields.push(field);
    this.index(field);
    return field;
  }

  async updateField(
    nameOrKey: string,
    changes: {
      name?: string;
      config?: Record<string, unknown>;
      position?: number;
      isArchived?: boolean;
    },
  ): Promise<FieldDto> {
    const existing = this.field(nameOrKey);
    const updated = await this.http.request<FieldDto>(
      "PUT",
      `/objects/${this.id}/fields/${existing.id}`,
      { body: changes },
    );
    this.byName.delete(existing.name.toLowerCase());
    Object.assign(existing, updated);
    this.index(existing);
    return updated;
  }

  records(): RecordQuery {
    return new RecordQuery(this.http, this);
  }

  /**
   * Writes one record. A `relation` field takes the complete array of related
   * record ids and is saved in the same transaction as the rest of the row —
   * no follow-up `createLink` calls, nothing half-written if one id is wrong.
   */
  async create(data: Row, options: WriteOptions = {}): Promise<RecordDto> {
    return this.http.request<RecordDto>("POST", `/objects/${this.id}/records`, {
      body: { data: this.resolveData(data), ...this.writeFlag(options) },
    });
  }

  async createMany(
    rows: Row[],
    options: { chunkSize?: number } & WriteOptions = {},
  ): Promise<BulkCreateRecordsResult> {
    const dryRun = this.dryRunFor(options);
    if (rows.length === 0) {
      return { created: 0, records: [], ...(dryRun ? { dryRun } : {}) };
    }
    const chunkSize = Math.min(
      options.chunkSize ?? MAX_BULK_CREATE,
      MAX_BULK_CREATE,
    );
    const result: BulkCreateRecordsResult = { created: 0, records: [] };

    for (let start = 0; start < rows.length; start += chunkSize) {
      const chunk = rows.slice(start, start + chunkSize);
      const page = await this.http.request<BulkCreateRecordsResult>(
        "POST",
        `/objects/${this.id}/records/bulk`,
        {
          body: {
            records: chunk.map((row) => ({ data: this.resolveData(row) })),
            ...this.writeFlag(options),
          },
        },
      );
      result.created += page.created;
      result.records.push(...page.records);
    }
    // Chunking is ours, not the server's: one rolled-back chunk says nothing
    // about the next one, so report the mode we asked for, not a per-chunk flag.
    if (dryRun) result.dryRun = true;
    return result;
  }

  async updateWhere(
    filters: RecordFilter[],
    data: Row,
    options: { limit?: number } & WriteOptions = {},
  ): Promise<BulkUpdateRecordsResult> {
    return this.http.request<BulkUpdateRecordsResult>(
      "POST",
      `/objects/${this.id}/records/bulk-update`,
      {
        body: {
          filters,
          data: this.resolveData(data),
          limit: options.limit,
          ...this.writeFlag(options),
        },
      },
    );
  }

  async get(recordId: string): Promise<RecordDto> {
    return this.http.request<RecordDto>(
      "GET",
      `/objects/${this.id}/records/${recordId}`,
    );
  }

  /**
   * Read many records by id in one filtered query per `MAX_FILTER_VALUES` ids,
   * instead of one request per id — the fetch half of the relation-ids pattern
   * (a relation field comes back in `data` as an array of related record ids).
   *
   * Ids come back in the order asked for. An id the actor's row scopes exclude,
   * or one that is deleted, is simply absent rather than an error, so a shorter
   * result than input is normal.
   */
  async getMany(
    ids: string[],
    options: { chunkSize?: number } = {},
  ): Promise<RecordDto[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const chunkSize = Math.min(
      options.chunkSize ?? MAX_FILTER_VALUES,
      MAX_FILTER_VALUES,
    );
    const found = new Map<string, RecordDto>();

    for (let start = 0; start < unique.length; start += chunkSize) {
      const chunk = unique.slice(start, start + chunkSize);
      const records = await this.records().whereIds(chunk).fetchAll();
      for (const record of records) found.set(record.id, record);
    }
    return unique
      .map((id) => found.get(id))
      .filter((record): record is RecordDto => record !== undefined);
  }

  /**
   * The third argument is either the optimistic-lock version on its own —
   * `update(id, data, rec.version)` — or an options object carrying it:
   * `update(id, data, { version, dryRun: true })`. Omitted, the current
   * version is read first.
   */
  async update(
    recordId: string,
    data: Row,
    options: number | VersionedWriteOptions = {},
  ): Promise<RecordDto> {
    const opts = versionedOptions(options);
    const currentVersion = opts.version ?? (await this.get(recordId)).version;
    return this.http.request<RecordDto>(
      "PUT",
      `/objects/${this.id}/records/${recordId}`,
      {
        body: {
          data: this.resolveData(data),
          version: currentVersion,
          ...this.writeFlag(opts),
        },
      },
    );
  }

  /** Soft delete. The server has no dry run for it — see {@link DryRunUnsupportedError}. */
  async delete(
    recordId: string,
    options: number | VersionedWriteOptions = {},
  ): Promise<void> {
    const opts = versionedOptions(options);
    this.refuseDryRun("delete", opts);
    const currentVersion = opts.version ?? (await this.get(recordId)).version;
    await this.http.request<unknown>(
      "DELETE",
      `/objects/${this.id}/records/${recordId}`,
      { query: { version: currentVersion } },
    );
  }

  async restore(
    recordId: string,
    version: number,
    options: WriteOptions = {},
  ): Promise<RecordDto> {
    this.refuseDryRun("restore", options);
    return this.http.request<RecordDto>(
      "POST",
      `/objects/${this.id}/records/${recordId}/restore`,
      { body: { version } },
    );
  }

  async listLinks(
    recordId: string,
    fieldNameOrKey: string,
    direction: LinkDirection = "outgoing",
  ): Promise<unknown> {
    const field = this.field(fieldNameOrKey);
    return this.http.request<unknown>(
      "GET",
      `/objects/${this.id}/records/${recordId}/links`,
      { query: { fieldId: field.id, direction } },
    );
  }

  /**
   * Adds one link without restating the list. Only needed past
   * {@link MAX_RELATION_IDS} — below that, write the whole array in `data`
   * through `create`/`update` and get one transaction instead of 1 + N.
   */
  async createLink(
    recordId: string,
    fieldNameOrKey: string,
    targetRecordId: string,
    position = 0,
    options: WriteOptions = {},
  ): Promise<unknown> {
    this.refuseDryRun("createLink", options);
    const field = this.field(fieldNameOrKey);
    return this.http.request<unknown>(
      "POST",
      `/objects/${this.id}/records/${recordId}/links/${field.id}`,
      { body: { targetRecordId, position } },
    );
  }

  async deleteLink(
    recordId: string,
    fieldNameOrKey: string,
    targetRecordId: string,
    options: WriteOptions = {},
  ): Promise<void> {
    this.refuseDryRun("deleteLink", options);
    const field = this.field(fieldNameOrKey);
    await this.http.request<unknown>(
      "DELETE",
      `/objects/${this.id}/records/${recordId}/links/${field.id}/${targetRecordId}`,
    );
  }

  /**
   * The ids a relation field holds on a record, straight out of `data` — the
   * list to edit and send back. Empty for a record fetched by
   * `get(id)`, which does not carry relations; query or `preload` instead.
   */
  linkedIds(record: RecordDto, fieldNameOrKey: string): string[] {
    const value = record.data[this.fieldKey(fieldNameOrKey)];
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string")
      : [];
  }

  /**
   * Unknown names fall through as-is rather than throwing: a preload the server
   * did not return is an empty list, not a caller error.
   */
  related(record: RecordDto, field: string | FieldDto): RecordDto[] {
    const key =
      typeof field === "string"
        ? (this.lookup(field)?.key ?? field)
        : field.key;
    return record.related?.[key] ?? [];
  }

  rowFromRecord(record: RecordDto, by: "name" | "key" = "name"): Row {
    const row: Row = {
      id: record.id,
      version: record.version,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
    const values = { ...record.data, ...(record.computedData ?? {}) };
    for (const [key, value] of Object.entries(values)) {
      const field = this.byKey.get(key);
      const column = by === "name" && field ? field.name : key;
      row[column] = value;
    }
    return row;
  }
}

export class RecordQuery {
  private readonly filters: RecordFilter[] = [];
  private readonly sorts: RecordSort[] = [];
  private readonly preloads: RecordPreload[] = [];
  private cursorValue?: string;
  private limitValue?: number;
  private includeTotalValue?: boolean;

  constructor(
    private readonly http: Http,
    private readonly object: ObjectHandle,
  ) {}

  where(
    fieldNameOrKey: string,
    operator: FilterOperator,
    value?: unknown,
  ): this {
    checkFilterValue(fieldNameOrKey, operator, value);
    this.filters.push({
      field: this.object.filterKey(fieldNameOrKey),
      operator,
      value,
    });
    return this;
  }

  /** `where(field, "in", values)` — matches any of at most 200 values. */
  whereIn(fieldNameOrKey: string, values: unknown[]): this {
    return this.where(fieldNameOrKey, "in", values);
  }

  /** `where(field, "not_in", values)`. A record with no value still matches. */
  whereNotIn(fieldNameOrKey: string, values: unknown[]): this {
    return this.where(fieldNameOrKey, "not_in", values);
  }

  /**
   * Filter on the records' own ids. Bypasses field resolution, so it still
   * means the record id on an object that happens to own a field named "id".
   * At most `MAX_FILTER_VALUES` ids — `ObjectHandle.getMany` chunks for you.
   */
  whereIds(ids: string[]): this {
    checkFilterValue(RECORD_ID_FILTER_KEY, "in", ids);
    this.filters.push({
      field: RECORD_ID_FILTER_KEY,
      operator: "in",
      value: ids,
    });
    return this;
  }

  orderBy(fieldNameOrKey: string, direction: SortDirection = "asc"): this {
    this.sorts.push({
      field: this.object.fieldKey(fieldNameOrKey),
      direction,
    });
    return this;
  }

  preload(
    field: string | FieldDto,
    options: { limit?: number; direction?: LinkDirection } = {},
  ): this {
    const resolved =
      typeof field === "string" ? this.object.field(field) : field;
    const direction =
      options.direction ??
      (resolved.objectId === this.object.id ? "outgoing" : "incoming");
    this.preloads.push({
      field: resolved.key,
      direction,
      limit: options.limit,
    });
    return this;
  }

  cursor(cursor: string): this {
    this.cursorValue = cursor;
    return this;
  }

  limit(limit: number): this {
    this.limitValue = limit;
    return this;
  }

  withTotal(): this {
    this.includeTotalValue = true;
    return this;
  }

  build(): QueryRecordsRequest {
    return {
      filters: this.filters.length > 0 ? this.filters : undefined,
      sorts: this.sorts.length > 0 ? this.sorts : undefined,
      preload: this.preloads.length > 0 ? this.preloads : undefined,
      cursor: this.cursorValue,
      limit: this.limitValue,
      includeTotal: this.includeTotalValue,
    };
  }

  /**
   * One patch applied to every matching record. With a relation field in
   * `data` that means *every* match ends up with exactly that list — `[]`
   * strips the links off up to 5 000 records in one call. `{ dryRun: true }`
   * returns the real `matched` first.
   */
  async update(
    data: Row,
    options: { limit?: number } & WriteOptions = {},
  ): Promise<BulkUpdateRecordsResult> {
    return this.object.updateWhere(this.filters, data, {
      limit: options.limit ?? this.limitValue,
      dryRun: options.dryRun,
    });
  }

  async fetch(): Promise<RecordPage> {
    return this.http.request<RecordPage>(
      "POST",
      `/objects/${this.object.id}/records/query`,
      { body: this.build() },
    );
  }

  async fetchAll(options: { max?: number } = {}): Promise<RecordDto[]> {
    const max = options.max ?? Infinity;
    const records: RecordDto[] = [];
    let cursor: string | undefined = this.cursorValue;

    for (;;) {
      const body: QueryRecordsRequest = {
        ...this.build(),
        cursor,
        limit: Math.min(this.limitValue ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE),
        includeTotal: undefined,
      };
      const page = await this.http.request<RecordPage>(
        "POST",
        `/objects/${this.object.id}/records/query`,
        { body },
      );
      records.push(...page.records);
      if (records.length >= max) return records.slice(0, max);
      if (!page.hasMore || !page.nextCursor) return records;
      cursor = page.nextCursor;
    }
  }

  async first(): Promise<RecordDto | undefined> {
    const page = await this.limit(1).fetch();
    return page.records[0];
  }

  async count(): Promise<number> {
    const page = await this.limit(1).withTotal().fetch();
    return page.total ?? page.records.length;
  }

  async toFrame(
    options: { by?: "name" | "key"; max?: number } = {},
  ): Promise<DataFrame<Row>> {
    const records = await this.fetchAll({ max: options.max });
    return DataFrame.from(
      records.map((record) =>
        this.object.rowFromRecord(record, options.by ?? "name"),
      ),
    );
  }
}
