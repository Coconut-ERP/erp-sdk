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

/**
 * Something addressed by display name that the workspace does not hold. The
 * message lists what does exist, because the name *is* the address and a typo
 * is the likeliest cause.
 */
class UnknownByNameError extends Error {
  constructor(
    kind: string,
    /** The name or id that was asked for. */
    readonly wanted: string,
    readonly known: string[],
  ) {
    super(
      `${kind} not found: "${wanted}"` +
        (known.length > 0 ? `. Known: ${known.join(", ")}` : ""),
    );
  }
}

export class UnknownWorkflowError extends UnknownByNameError {
  constructor(
    readonly workflow: string,
    known: string[] = [],
  ) {
    super("Workflow", workflow, known);
    this.name = "UnknownWorkflowError";
  }
}

/**
 * A shared variable this caller cannot read. Inside a workflow run that is two
 * causes the server deliberately answers the same way — no such key, or this
 * workflow is not on its access list — so the message names both. Use
 * `variables.value(key)` where absence is ordinary, such as a first run.
 */
export class UnknownWorkflowVariableError extends Error {
  constructor(readonly key: string) {
    super(
      `Shared variable not found: "${key}". Either no variable has that key, ` +
        "or the workflow running this script was not granted it",
    );
    this.name = "UnknownWorkflowVariableError";
  }
}

export class UnknownDashboardError extends UnknownByNameError {
  constructor(
    readonly dashboard: string,
    known: string[] = [],
  ) {
    super("Dashboard", dashboard, known);
    this.name = "UnknownDashboardError";
  }
}

export class UnknownQueryError extends UnknownByNameError {
  constructor(
    readonly query: string,
    readonly dashboard: string,
    known: string[] = [],
  ) {
    super(`Query on dashboard "${dashboard}"`, query, known);
    this.name = "UnknownQueryError";
  }
}

/**
 * A definition the server would refuse anyway — wrong trigger, code without an
 * `async function main()`, an env name it will not store, or a shared variable
 * whose key or value it would reject. Caught here so the fix arrives without a
 * round trip.
 */
export class WorkflowDefinitionError extends Error {
  constructor(
    readonly field: "trigger" | "code" | "env" | "variable",
    readonly reason: string,
  ) {
    super(`Workflow ${field} is invalid: ${reason}`);
    this.name = "WorkflowDefinitionError";
  }
}

/** A run that finished in `ERROR`. `error` carries the thrown message and logs. */
export class WorkflowRunFailedError extends Error {
  constructor(
    readonly workflow: string,
    readonly run: { id: string; status: string; error?: string },
  ) {
    super(`Workflow "${workflow}" run failed: ${run.error ?? run.status}`);
    this.name = "WorkflowRunFailedError";
  }
}

/** Waiting gave up while the run was still queued or executing. It keeps running. */
export class WorkflowRunTimeoutError extends Error {
  constructor(
    readonly workflow: string,
    readonly run: { id: string; status: string },
    readonly timeoutMs: number,
  ) {
    super(
      `Workflow "${workflow}" run ${run.id} was still "${run.status}" after ` +
        `${timeoutMs}ms. The run itself is not cancelled — poll getRun(runId) ` +
        "later, or raise { timeoutMs }.",
    );
    this.name = "WorkflowRunTimeoutError";
  }
}

/**
 * SQL the query endpoint would refuse: it runs **one** read-only `SELECT`
 * (a leading `WITH` is fine) against workspace tables addressed by display
 * name. No DML, no DDL, no second statement.
 */
export class SqlQueryError extends Error {
  constructor(readonly reason: string) {
    super(`Invalid dashboard SQL: ${reason}`);
    this.name = "SqlQueryError";
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

/**
 * A change to an object *definition* the server would refuse anyway — an empty
 * body, a blank name, more groups than it stores. Caught here so the fix
 * arrives without a round trip.
 */
export class ObjectDefinitionError extends Error {
  constructor(
    readonly object: string,
    readonly reason: string,
  ) {
    super(`Object "${object}" cannot be updated: ${reason}`);
    this.name = "ObjectDefinitionError";
  }
}

/**
 * The bytes never reached storage. An upload is three steps — start, PUT the
 * bytes to the presigned URL, complete — and this is the middle one failing,
 * which leaves a file row stuck in `uploading` that nothing will complete.
 */
export class FileUploadError extends Error {
  constructor(
    readonly file: string,
    readonly status: number,
    readonly detail: string,
  ) {
    super(
      `Uploading "${file}" to storage failed with HTTP ${status}: ${detail}. ` +
        'The file row exists but stays in status "uploading" — delete it, or ' +
        "PUT the bytes to the presigned URL again with the same Content-Type " +
        "and call files.completeUpload(fileId).",
    );
    this.name = "FileUploadError";
  }
}

/**
 * A wiki page addressed by a slug the workspace does not hold. A page's slug
 * *is* its address — the title is not — so a page created as "Chính sách kho"
 * answers to `chinh-sach-kho`. Search for it with `wiki.search(text)`.
 */
export class UnknownWikiPageError extends Error {
  constructor(
    readonly slug: string,
    readonly known: string[] = [],
  ) {
    super(
      `Wiki page not found: "${slug}"` +
        (known.length > 0 ? `. Known: ${known.join(", ")}` : "") +
        ". Pages are addressed by slug, not title — wiki.search(text) finds one.",
    );
    this.name = "UnknownWikiPageError";
  }
}

/**
 * A wiki page the server would refuse anyway: a type or confidence outside the
 * enums, a summary past the cap, an update carrying no change.
 */
export class WikiPageError extends Error {
  constructor(
    readonly field: string,
    readonly reason: string,
  ) {
    super(`Wiki page ${field} is invalid: ${reason}`);
    this.name = "WikiPageError";
  }
}
