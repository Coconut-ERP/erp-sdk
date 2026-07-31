import lodash from "lodash";

const {
  countBy: _countBy,
  groupBy: _groupBy,
  keyBy: _keyBy,
  maxBy,
  meanBy,
  minBy,
  orderBy,
  pick,
  sumBy,
  uniqBy,
} = lodash;
import type { FilterOperator, SortDirection } from "./types";

export type Row = Record<string, unknown>;

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function isEmptyValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function compareOrdered(value: unknown, target: unknown): number {
  if (typeof value === "number" || typeof target === "number") {
    return toNumber(value) - toNumber(target);
  }
  const a = String(value ?? "");
  const b = String(target ?? "");
  return a < b ? -1 : a > b ? 1 : 0;
}

export function matchesOperator(
  value: unknown,
  operator: FilterOperator,
  target?: unknown,
): boolean {
  switch (operator) {
    case "equals":
      return value === target || String(value) === String(target);
    case "not_equals":
      return !(value === target || String(value) === String(target));
    case "contains":
      return String(value ?? "")
        .toLowerCase()
        .includes(String(target ?? "").toLowerCase());
    case "greater_than":
      return !isEmptyValue(value) && compareOrdered(value, target) > 0;
    case "greater_than_or_equal":
      return !isEmptyValue(value) && compareOrdered(value, target) >= 0;
    case "less_than":
      return !isEmptyValue(value) && compareOrdered(value, target) < 0;
    case "less_than_or_equal":
      return !isEmptyValue(value) && compareOrdered(value, target) <= 0;
    case "is_empty":
      return isEmptyValue(value);
    case "is_not_empty":
      return !isEmptyValue(value);
  }
}

export type AggSpec<T extends Row> =
  | ["count"]
  | ["sum" | "avg" | "min" | "max", keyof T & string]
  | ((rows: T[]) => unknown);

function runAgg<T extends Row>(rows: T[], spec: AggSpec<T>): unknown {
  if (typeof spec === "function") return spec(rows);
  const [fn, field] = spec;
  switch (fn) {
    case "count":
      return rows.length;
    case "sum":
      return sumBy(rows, (row) => toNumber(row[field as string]));
    case "avg":
      return rows.length === 0 ? null : meanBy(rows, (row) => toNumber(row[field as string]));
    case "min": {
      const row = minBy(rows, (r) => toNumber(r[field as string]));
      return row ? row[field as string] : null;
    }
    case "max": {
      const row = maxBy(rows, (r) => toNumber(r[field as string]));
      return row ? row[field as string] : null;
    }
  }
}

export class GroupedFrame<T extends Row> {
  constructor(
    private readonly groupMap: Record<string, T[]>,
    private readonly keyName: string,
  ) {}

  frames(): Map<string, DataFrame<T>> {
    return new Map(
      Object.entries(this.groupMap).map(([key, rows]) => [
        key,
        new DataFrame(rows),
      ]),
    );
  }

  agg(specs: Record<string, AggSpec<T>>): DataFrame<Row> {
    const rows = Object.entries(this.groupMap).map(([key, groupRows]) => {
      const row: Row = { [this.keyName]: key };
      for (const [name, spec] of Object.entries(specs)) {
        row[name] = runAgg(groupRows, spec);
      }
      return row;
    });
    return new DataFrame(rows);
  }

  count(): DataFrame<Row> {
    return this.agg({ count: ["count"] });
  }

  sum(field: keyof T & string, as = "sum"): DataFrame<Row> {
    return this.agg({ [as]: ["sum", field] });
  }

  avg(field: keyof T & string, as = "avg"): DataFrame<Row> {
    return this.agg({ [as]: ["avg", field] });
  }
}

export class DataFrame<T extends Row> {
  constructor(private readonly data: T[]) {}

  static from<R extends Row>(rows: R[]): DataFrame<R> {
    return new DataFrame(rows);
  }

  toArray(): T[] {
    return [...this.data];
  }

  count(): number {
    return this.data.length;
  }

  isEmpty(): boolean {
    return this.data.length === 0;
  }

  first(): T | undefined {
    return this.data[0];
  }

  last(): T | undefined {
    return this.data[this.data.length - 1];
  }

  at(index: number): T | undefined {
    return index < 0 ? this.data[this.data.length + index] : this.data[index];
  }

  head(n = 5): DataFrame<T> {
    return new DataFrame(this.data.slice(0, n));
  }

  tail(n = 5): DataFrame<T> {
    return new DataFrame(this.data.slice(-n));
  }

  slice(start: number, end?: number): DataFrame<T> {
    return new DataFrame(this.data.slice(start, end));
  }

  filter(predicate: (row: T, index: number) => boolean): DataFrame<T> {
    return new DataFrame(this.data.filter(predicate));
  }

  where(
    field: keyof T & string,
    operator: FilterOperator,
    value?: unknown,
  ): DataFrame<T> {
    return this.filter((row) => matchesOperator(row[field], operator, value));
  }

  map<R extends Row>(mapper: (row: T, index: number) => R): DataFrame<R> {
    return new DataFrame(this.data.map(mapper));
  }

  forEach(fn: (row: T, index: number) => void): void {
    this.data.forEach(fn);
  }

  select<K extends keyof T & string>(...fields: K[]): DataFrame<Pick<T, K>> {
    return new DataFrame(this.data.map((row) => pick(row, fields)));
  }

  rename(mapping: Record<string, string>): DataFrame<Row> {
    return new DataFrame(
      this.data.map((row) => {
        const next: Row = {};
        for (const [key, value] of Object.entries(row)) {
          next[mapping[key] ?? key] = value;
        }
        return next;
      }),
    );
  }

  sortBy(
    fields: (keyof T & string) | (keyof T & string)[],
    directions: SortDirection | SortDirection[] = "asc",
  ): DataFrame<T> {
    return new DataFrame(orderBy(this.data, fields, directions) as T[]);
  }

  unique(): DataFrame<T> {
    return new DataFrame(uniqBy(this.data, (row) => JSON.stringify(row)));
  }

  uniqueBy(field: (keyof T & string) | ((row: T) => unknown)): DataFrame<T> {
    return new DataFrame(uniqBy(this.data, field));
  }

  pluck<K extends keyof T & string>(field: K): T[K][] {
    return this.data.map((row) => row[field]);
  }

  sum(field: keyof T & string): number {
    return sumBy(this.data, (row) => toNumber(row[field]));
  }

  avg(field: keyof T & string): number | null {
    return this.data.length === 0
      ? null
      : meanBy(this.data, (row) => toNumber(row[field]));
  }

  min(field: keyof T & string): unknown {
    const row = minBy(this.data, (r) => toNumber(r[field]));
    return row ? row[field] : null;
  }

  max(field: keyof T & string): unknown {
    const row = maxBy(this.data, (r) => toNumber(r[field]));
    return row ? row[field] : null;
  }

  countBy(field: (keyof T & string) | ((row: T) => string)): Record<string, number> {
    return _countBy(this.data, field);
  }

  keyBy(field: (keyof T & string) | ((row: T) => string)): Record<string, T> {
    return _keyBy(this.data, field);
  }

  groupBy(
    field: (keyof T & string) | ((row: T) => string),
    options: { as?: string } = {},
  ): GroupedFrame<T> {
    const keyName =
      options.as ?? (typeof field === "string" ? field : "key");
    return new GroupedFrame(_groupBy(this.data, field), keyName);
  }

  leftJoin<O extends Row>(
    other: DataFrame<O>,
    leftKey: keyof T & string,
    rightKey?: keyof O & string,
    options: { prefix?: string } = {},
  ): DataFrame<Row> {
    const index = _keyBy(other.toArray(), (row) =>
      String(row[(rightKey ?? leftKey) as string]),
    );
    const prefix = options.prefix ?? "";
    return new DataFrame(
      this.data.map((row) => {
        const match = index[String(row[leftKey])];
        if (!match) return { ...row };
        const joined: Row = { ...row };
        for (const [key, value] of Object.entries(match)) {
          const target = prefix ? `${prefix}${key}` : key;
          if (!(target in joined)) joined[target] = value;
        }
        return joined;
      }),
    );
  }
}
