import type { RequiredPermission } from "./types";

export class ErpApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly trace?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ErpApiError";
  }
}

export class MissingPermissionsError extends Error {
  constructor(readonly missing: RequiredPermission[]) {
    super(
      `API key is missing required permissions: ${missing
        .map((p) => `${p.resource}:${p.action}`)
        .join(", ")}`,
    );
    this.name = "MissingPermissionsError";
  }
}

export class UnknownObjectError extends Error {
  constructor(readonly object: string) {
    super(`Object not found in workspace: "${object}"`);
    this.name = "UnknownObjectError";
  }
}

export interface SchemaGap {
  object: string;
  /** Absent when the whole table is missing. */
  field?: string;
  /** The type the app declares for a missing or conflicting field. */
  type?: string;
  /** Only on a conflict: the type the workspace currently holds. */
  currentType?: string;
}

/**
 * The workspace does not hold what `schema.json` declares. The app cannot fix
 * this itself — creating tables is the deployer's reviewed step.
 */
export class SchemaMismatchError extends Error {
  constructor(
    /** Tables and fields that are missing. */
    readonly missing: SchemaGap[],
    /** Fields that exist with a different type — a human has to resolve these. */
    readonly conflicts: SchemaGap[] = [],
  ) {
    const describe = (gap: SchemaGap) =>
      gap.field ? `${gap.object}.${gap.field}` : gap.object;
    const parts = [];
    if (missing.length > 0) {
      parts.push(`missing ${missing.map(describe).join(", ")}`);
    }
    for (const gap of conflicts) {
      parts.push(
        `${describe(gap)} is ${gap.currentType}, this app needs ${gap.type}`,
      );
    }
    super(
      `The workspace does not match schema.json: ${parts.join("; ")}. ` +
        "Ask whoever deploys this app to review its schema " +
        "(mini app detail → “Duyệt schema” → Áp dụng & deploy).",
    );
    this.name = "SchemaMismatchError";
  }
}

/**
 * A filter the server would refuse anyway, caught before it costs a round trip:
 * `in`/`not_in` take a non-empty array of at most `MAX_FILTER_VALUES` values.
 */
export class FilterValueError extends Error {
  constructor(
    readonly field: string,
    readonly operator: string,
    readonly reason: string,
  ) {
    super(`Filter "${field}" with operator "${operator}": ${reason}`);
    this.name = "FilterValueError";
  }
}

/**
 * A relation value the server would refuse anyway. A relation field is written
 * as **the whole list** of related record ids; `null` (or omitting the key)
 * leaves the existing links alone and `[]` clears them.
 */
export class RelationValueError extends Error {
  constructor(
    readonly field: string,
    readonly reason: string,
  ) {
    super(
      `Relation field "${field}": ${reason}. A relation takes the complete ` +
        "array of related record ids (at most 100); null or an absent key " +
        "leaves its links unchanged, [] removes them all.",
    );
    this.name = "RelationValueError";
  }
}

/**
 * A mutation the backend has no dry run for, attempted while the client is in
 * dry-run mode (`ERP_ENV=development`). Refusing is the point: pretending to
 * delete and deleting for real are both wrong answers here.
 */
export class DryRunUnsupportedError extends Error {
  constructor(readonly operation: string) {
    super(
      `${operation} cannot be dry-run — the server has no dryRun for it, and ` +
        "this client is in development mode. Pass { dryRun: false } to run it " +
        `for real, or set ERP_ENV=production.`,
    );
    this.name = "DryRunUnsupportedError";
  }
}

export class UnknownFieldError extends Error {
  constructor(
    readonly field: string,
    readonly objectName: string,
    readonly known: string[],
  ) {
    super(
      `Field "${field}" does not exist on object "${objectName}". Known fields: ${known.join(", ")}`,
    );
    this.name = "UnknownFieldError";
  }
}
