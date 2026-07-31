import { DataFrame, type Row } from "./frame";
import { UnknownFieldError } from "./errors";
import type { Http } from "./http";
import type {
  FieldDto,
  FilterOperator,
  LinkDirection,
  ObjectDto,
  QueryRecordsRequest,
  RecordDto,
  RecordFilter,
  RecordPage,
  RecordSort,
  SortDirection,
} from "./types";

const MAX_PAGE_SIZE = 100;

export class ObjectHandle {
  private readonly byKey = new Map<string, FieldDto>();
  private readonly byName = new Map<string, FieldDto>();

  constructor(
    private readonly http: Http,
    readonly meta: ObjectDto,
    readonly fields: FieldDto[],
  ) {
    for (const field of fields) {
      this.index(field);
    }
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

  field(nameOrKey: string): FieldDto {
    const field =
      this.byKey.get(nameOrKey) ?? this.byName.get(nameOrKey.toLowerCase());
    if (!field) {
      throw new UnknownFieldError(
        nameOrKey,
        this.meta.name,
        this.fields.map((f) => f.name),
      );
    }
    return field;
  }

  fieldKey(nameOrKey: string): string {
    return this.field(nameOrKey).key;
  }

  private resolveData(data: Row): Row {
    const resolved: Row = {};
    for (const [key, value] of Object.entries(data)) {
      resolved[this.fieldKey(key)] = value;
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

  async create(data: Row): Promise<RecordDto> {
    return this.http.request<RecordDto>(
      "POST",
      `/objects/${this.id}/records`,
      { body: { data: this.resolveData(data) } },
    );
  }

  async get(recordId: string): Promise<RecordDto> {
    return this.http.request<RecordDto>(
      "GET",
      `/objects/${this.id}/records/${recordId}`,
    );
  }

  async update(recordId: string, data: Row, version?: number): Promise<RecordDto> {
    const currentVersion = version ?? (await this.get(recordId)).version;
    return this.http.request<RecordDto>(
      "PUT",
      `/objects/${this.id}/records/${recordId}`,
      { body: { data: this.resolveData(data), version: currentVersion } },
    );
  }

  async delete(recordId: string, version?: number): Promise<void> {
    const currentVersion = version ?? (await this.get(recordId)).version;
    await this.http.request<unknown>(
      "DELETE",
      `/objects/${this.id}/records/${recordId}`,
      { query: { version: currentVersion } },
    );
  }

  async restore(recordId: string, version: number): Promise<RecordDto> {
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

  async createLink(
    recordId: string,
    fieldNameOrKey: string,
    targetRecordId: string,
    position = 0,
  ): Promise<unknown> {
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
  ): Promise<void> {
    const field = this.field(fieldNameOrKey);
    await this.http.request<unknown>(
      "DELETE",
      `/objects/${this.id}/records/${recordId}/links/${field.id}/${targetRecordId}`,
    );
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
    this.filters.push({
      field: this.object.fieldKey(fieldNameOrKey),
      operator,
      value,
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
      cursor: this.cursorValue,
      limit: this.limitValue,
      includeTotal: this.includeTotalValue,
    };
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
