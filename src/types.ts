export interface Envelope<T> {
  success: boolean;
  message: string;
  statusCode: number;
  data: T;
  trace?: string;
}

export type Resource =
  | "workspace"
  | "workspace:member"
  | "workspace:invitation"
  | "user"
  | "role"
  | "object"
  | "object:field"
  | "object:record"
  | "object:view"
  | "object:event"
  | "object:index"
  | "object:rule"
  | "workflow"
  | "workflow:run"
  | "iam:rule"
  | "iam:service_account"
  | "file"
  | "file:folder"
  | "dashboard"
  | "dashboard:query"
  | (string & {});

export type Action =
  | "create"
  | "read"
  | "update"
  | "delete"
  | "manage"
  | "*"
  | (string & {});

export interface RequiredPermission {
  resource: Resource;
  action: Action;
}

export interface PermissionDto {
  id: string;
  ruleId: string;
  resource: string;
  action: string;
  effect: "allow" | "deny";
  objectId?: string;
  scopeType: string;
  scope: unknown;
  createdAt: string;
}

export interface ObjectDto {
  id: string;
  workspaceId: string;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface FieldDto {
  id: string;
  objectId: string;
  key: string;
  name: string;
  type: string;
  config: Record<string, unknown> | null;
  position: number;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RecordDto {
  id: string;
  objectId: string;
  /**
   * Field key → value. A `relation` field appears as an array of record ids —
   * always on `POST /records/query`, and on a create/update response for the
   * relation fields that request wrote.
   */
  data: Record<string, unknown>;
  computedData: Record<string, unknown> | null;
  computeStatus: string;
  computeError?: string;
  computeStartedAt?: string;
  computedAt?: string;
  version: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  related?: Record<string, RecordDto[]>;
  /** Present and `true` only when the write was a dry run — nothing was saved. */
  dryRun?: boolean;
}

export interface RecordPage {
  records: RecordDto[];
  nextCursor?: string;
  hasMore: boolean;
  total?: number;
}

export type FilterOperator =
  | "equals"
  | "not_equals"
  | "contains"
  /** Membership: value is an array of at most 200 values. */
  | "in"
  | "not_in"
  | "greater_than"
  | "greater_than_or_equal"
  | "less_than"
  | "less_than_or_equal"
  | "is_empty"
  | "is_not_empty";

export interface RecordFilter {
  /**
   * A field key, or the literal `"id"` to filter on the record's own id —
   * the one filter target that is not a field (`equals`, `not_equals`, `in`,
   * `not_in` only).
   */
  field: string;
  operator: FilterOperator;
  /** An array for `in`/`not_in`, absent for `is_empty`/`is_not_empty`. */
  value?: unknown;
}

export type SortDirection = "asc" | "desc";

export interface RecordSort {
  field: string;
  direction: SortDirection;
}

export type LinkDirection = "outgoing" | "incoming";

export interface RecordPreload {
  field: string;
  direction?: LinkDirection;
  limit?: number;
}

export interface QueryRecordsRequest {
  filters?: RecordFilter[];
  sorts?: RecordSort[];
  preload?: RecordPreload[];
  cursor?: string;
  limit?: number;
  includeTotal?: boolean;
}

export interface CreateRecordRequest {
  data: Record<string, unknown>;
  /** Validate and roll back instead of saving. Turns the 201 into a 200. */
  dryRun?: boolean;
}

export interface UpdateRecordRequest {
  data: Record<string, unknown>;
  version: number;
  dryRun?: boolean;
}

export interface BulkCreateRecordsRequest {
  records: Array<{ data: Record<string, unknown> }>;
  /** Request-level only — a `dryRun` inside a `records[]` entry is ignored. */
  dryRun?: boolean;
}

export interface BulkCreateRecordsResult {
  created: number;
  records: RecordDto[];
  /** `true` when nothing was saved; the returned ids were never persisted. */
  dryRun?: boolean;
}

export interface BulkUpdateRecordsRequest {
  filters?: RecordFilter[];
  data: Record<string, unknown>;
  limit?: number;
  dryRun?: boolean;
}

export interface BulkUpdateRecordsResult {
  matched: number;
  updated: number;
  hasMore: boolean;
  /** `true` when the transaction was rolled back — `matched` is still real. */
  dryRun?: boolean;
}

export interface UserDto {
  id: string;
  email: string;
  phoneNumber?: string;
  fullName?: string;
  displayName?: string;
  profileImageUrl?: string;
  jobTitle?: string;
  locale: string;
  timezone: string;
  isActive: boolean;
  isEmailVerified: boolean;
  isSuperAdmin: boolean;
  defaultWorkspaceId?: string;
}

export interface MiniAppInitData {
  initData: string;
  expiresIn: number;
}

export interface MiniAppSessionDto {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  user: UserDto;
}

export interface EnsureFieldSpec {
  name: string;
  type: string;
  config?: Record<string, unknown>;
  position?: number;
}

/** Page counts from the envelope's `meta`, on the endpoints that paginate by page number. */
export interface PageMeta {
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}

/** Who a workflow or dashboard is shared with. `object` is drive-only. */
export type SharingSubjectType = "user" | "role" | "group" | "object";

export type SharingAccess = "read" | "write" | "manage";

export interface SharingEntry {
  subjectType: SharingSubjectType;
  /** A user id, group id, role name or object id — matching `subjectType`. */
  subjectId: string;
  access: SharingAccess;
}

/** `workspace` = everyone in the workspace; `restricted` = only the grants. */
export type SharingVisibility = "workspace" | "restricted";

export interface SharingDto {
  visibility: SharingVisibility;
  entries: SharingEntry[];
  workflowId?: string;
  dashboardId?: string;
}

export type WorkflowTriggerType = "manual" | "cron";

/**
 * A 6-field cron expression (**with seconds**) or a descriptor such as
 * `@daily` / `@every 1h`, plus an IANA timezone. Five-field crontab syntax is
 * rejected by the server.
 */
export interface CronTriggerConfig {
  schedule: string;
  timezone: string;
}

export interface WorkflowTrigger {
  type: WorkflowTriggerType | (string & {});
  config?: Record<string, unknown>;
}

/** `draft` until published; `active` once a version is live. */
export type WorkflowStatus = "draft" | "active" | (string & {});

export interface WorkflowDto {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  status: WorkflowStatus;
  visibility: SharingVisibility;
  trigger: WorkflowTrigger;
  /** Only on the detail endpoint — the list omits it. */
  code?: string;
  /** Names only: every value comes back as `***`, never readable. */
  env: Record<string, string>;
  /** Optimistic lock — every mutation bumps it, and update/publish/delete need it. */
  version: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * `ENQUEUED` → `PENDING` (executing) → `SUCCESS` | `ERROR`. Anything else is
 * treated as unfinished by {@link WORKFLOW_RUN_PENDING_STATUSES}.
 */
export type WorkflowRunStatus =
  | "ENQUEUED"
  | "PENDING"
  | "SUCCESS"
  | "ERROR"
  | (string & {});

export interface WorkflowRunDto {
  id: string;
  status: WorkflowRunStatus;
  /** A JSON **string** — parse it with `runOutput(run)`. */
  output?: string;
  /** Present when `status` is `ERROR`: the thrown message, with logs appended. */
  error?: string;
  attempts: number;
  queueName: string;
  applicationVersion: string;
  createdAt: string;
  updatedAt: string;
  /** `0001-01-01T00:00:00Z` while the run is still queued. */
  startedAt?: string;
}

/** What the runner packs into {@link WorkflowRunDto.output}. */
export interface WorkflowRunOutput<T = unknown> {
  workflowId: string;
  version: number;
  result: T;
  logs?: string[];
  durationMs: number;
}

export interface DashboardDto {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  visibility: SharingVisibility;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Only on the detail endpoint. */
  queries?: DashboardQueryDto[];
}

export type ChartType =
  | "table"
  | "number"
  | "line"
  | "bar"
  | "area"
  | "pie"
  | "composed"
  | "scatter"
  | "radar"
  | "radial_bar"
  | "funnel"
  | "treemap"
  | "sankey"
  | "sunburst";

export type QueryParamType = "text" | "number" | "boolean" | "date" | "datetime";

/** Declares an `@name` placeholder used by the SQL. */
export interface QueryParamSpec {
  name: string;
  type: QueryParamType;
  label?: string;
  /** Used when a run sends no value for this parameter. */
  default?: unknown;
}

export interface DashboardQueryDto {
  id: string;
  dashboardId: string;
  name: string;
  sql: string;
  params: QueryParamSpec[];
  chartType?: ChartType;
  chartConfig?: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface QueryResultDto {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  /** `true` when the server cut the result at 1 000 rows. */
  truncated: boolean;
  /** The SQL actually executed, with every object name expanded into a CTE. */
  compiledSql?: string;
}
