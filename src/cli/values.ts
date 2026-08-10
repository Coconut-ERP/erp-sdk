import type { EnsureFieldSpec, FilterOperator, RecordFilter, RecordSort, SortDirection } from "../types";
import { UsageError } from "./args";

export const OPERATORS: FilterOperator[] = [
  "equals",
  "not_equals",
  "contains",
  "in",
  "not_in",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
  "is_empty",
  "is_not_empty",
];

const VALUELESS: FilterOperator[] = ["is_empty", "is_not_empty"];

const LIST_VALUED: FilterOperator[] = ["in", "not_in"];

/**
 * Values are read as JSON when they parse as JSON, otherwise as plain strings.
 * So `42` is a number, `true` a boolean, `null` null, and `approved` or
 * `2026-08-03` stay strings. Use `--data '{"...":...}'` when you need exact
 * control (e.g. the string "42").
 */
export function coerce(raw: string): unknown {
  if (raw === "") return "";
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/**
 * `in` and `not_in` take a list: a JSON array, or the comma-separated shorthand
 * `a,b,c` whose items are coerced one by one. A value that has to contain a
 * comma needs the JSON form.
 */
export function coerceList(raw: string): unknown[] {
  const parsed = coerce(raw);
  if (Array.isArray(parsed)) return parsed;
  return raw.split(",").map((item) => coerce(item.trim()));
}

/** `Field:operator:value` — or `Field=value` as shorthand for `equals`. */
export function parseFilter(input: string): RecordFilter {
  const firstColon = input.indexOf(":");
  if (firstColon > 0) {
    const rest = input.slice(firstColon + 1);
    const secondColon = rest.indexOf(":");
    const operator = (secondColon === -1 ? rest : rest.slice(0, secondColon)) as FilterOperator;
    if (OPERATORS.includes(operator)) {
      const field = input.slice(0, firstColon);
      if (VALUELESS.includes(operator)) return { field, operator };
      if (secondColon === -1) {
        throw new UsageError(`Filter "${input}" needs a value: "Field:${operator}:value"`);
      }
      const raw = rest.slice(secondColon + 1);
      if (LIST_VALUED.includes(operator)) {
        return { field, operator, value: coerceList(raw) };
      }
      return { field, operator, value: coerce(raw) };
    }
  }

  const eq = input.indexOf("=");
  if (eq > 0) {
    return { field: input.slice(0, eq), operator: "equals", value: coerce(input.slice(eq + 1)) };
  }

  throw new UsageError(
    `Cannot parse filter "${input}". Use "Field:operator:value" or "Field=value". ` +
      `Operators: ${OPERATORS.join(", ")}`,
  );
}

/** `Field` or `Field:asc` / `Field:desc`. */
export function parseSort(input: string): RecordSort {
  const colon = input.lastIndexOf(":");
  if (colon === -1) return { field: input, direction: "asc" };
  const direction = input.slice(colon + 1) as SortDirection;
  if (direction !== "asc" && direction !== "desc") {
    throw new UsageError(`Sort direction must be "asc" or "desc", got "${direction}"`);
  }
  return { field: input.slice(0, colon), direction };
}

/** `Field=value`, repeatable. */
export function parseAssignments(inputs: string[]): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const input of inputs) {
    const eq = input.indexOf("=");
    if (eq <= 0) throw new UsageError(`Cannot parse "${input}". Use --set "Field=value"`);
    data[input.slice(0, eq)] = coerce(input.slice(eq + 1));
  }
  return data;
}

/**
 * `Name:type`, `Name:type:{"source":"static","options":["a"]}`, or the
 * select shorthand `Name:single_select:a,b,c`.
 */
export function parseFieldSpec(input: string): EnsureFieldSpec {
  const firstColon = input.indexOf(":");
  if (firstColon <= 0) {
    throw new UsageError(`Cannot parse field "${input}". Use --field "Name:type[:config]"`);
  }
  const name = input.slice(0, firstColon);
  const rest = input.slice(firstColon + 1);
  const secondColon = rest.indexOf(":");
  if (secondColon === -1) return { name, type: rest };

  const type = rest.slice(0, secondColon);
  const configRaw = rest.slice(secondColon + 1);

  try {
    const parsed = JSON.parse(configRaw) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return { name, type, config: parsed as Record<string, unknown> };
    }
  } catch {
    // fall through to the select shorthand
  }

  if (type === "single_select" || type === "multi_select") {
    return {
      name,
      type,
      config: { source: "static", options: configRaw.split(",").map((o) => o.trim()) },
    };
  }

  throw new UsageError(
    `Field "${name}": config must be a JSON object (got "${configRaw}"). ` +
      `Comma-separated options are only a shorthand for single_select/multi_select.`,
  );
}
