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
  | "iam:group"
  | "iam:service_account"
  | "file"
  /**
   * The workspace's shared Public folder tree, on top of `file`. It grants
   * nothing on its own — `file` is what opens the module at all.
   */
  | "file:public"
  | "dashboard"
  | "dashboard:query"
  | "miniapp"
  | "ai"
  | "wiki"
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
  /**
   * The folders this object is filed under in the workspace sidebar — free
   * text, at most 10, and an object may sit in several at once. Purely how it
   * is presented; nothing about the data depends on them.
   */
  groups: string[];
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

export type WorkflowTriggerType = "manual" | "cron" | "webhook";

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
  /** Cron only. `manual` and `webhook` are rejected with any config at all. */
  config?: Record<string, unknown>;
}

/**
 * What `main(input)` receives on a `webhook` run. `body` is the exact string
 * that was posted — nothing parses it on the way, because a provider signs the
 * bytes it sent and a re-encoded body verifies against nothing.
 */
export interface WebhookInput {
  source: "webhook";
  method: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: string;
  /** RFC 3339, stamped when the delivery was accepted. */
  receivedAt: string;
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
  /**
   * Only on a `webhook` workflow, and it is a **credential**: whoever holds it
   * can start a run. Relative when the server has no public base URL
   * configured. Rotating it is not something the SDK does — that is a person's
   * call, made from their own session.
   */
  webhookUrl?: string;
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

/**
 * A shared variable: the workspace's key/value store for workflow scripts.
 * `value` is plain text and reads back as written — unlike a workflow's env,
 * which is a credential and comes back masked.
 */
export interface WorkflowVariableDto {
  id: string;
  key: string;
  value: string;
  description: string;
  /** The workflows whose runs may read and write it. Empty: none may. */
  workflowIds: string[];
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
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

export type QueryParamType =
  | "text"
  | "number"
  | "boolean"
  | "date"
  | "datetime";

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

/** Where a script that failed broke, as the transpiler or the runner saw it. */
export interface WorkflowScriptError {
  message: string;
  line?: number;
  column?: number;
  /** The script was still running when the runner's clock ran out. */
  timeout?: boolean;
}

/**
 * What `POST /workflows/test-run` answers: the script ran, and this is what it
 * did. `ok: false` is a script that threw — the request itself succeeded.
 */
export interface WorkflowTestRunDto<T = unknown> {
  ok: boolean;
  /** Always `true`: a test run puts the script's SDK in development mode. */
  dryRun: true;
  /** What `main()` returned. */
  result?: T;
  logs?: string[];
  durationMs: number;
  error?: WorkflowScriptError;
}

/** Files and folders carry `inherit` as well — a file follows its folder. */
export type FileVisibility = "inherit" | "workspace" | "restricted";

/**
 * `personal` is one member's own folder and `public` the workspace's shared
 * tree — both are system folders the server provisions and refuses to rename,
 * move or delete. Everything anyone creates is `normal`.
 */
export type FolderKind = "normal" | "personal" | "public";

export interface FolderDto {
  id: string;
  workspaceId: string;
  /** Absent only on the two system folders, which sit at the drive root. */
  parentId?: string;
  name: string;
  visibility: FileVisibility;
  kind: FolderKind;
  /** Set on a `personal` folder: whose it is. */
  ownerUserId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** `uploading` until the bytes land and the upload is completed. */
export type FileStatus = "uploading" | "available" | (string & {});

export interface FileDto {
  id: string;
  workspaceId: string;
  folderId?: string;
  name: string;
  visibility: FileVisibility;
  mimeType: string;
  sizeBytes: number;
  version: number;
  status: FileStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A started upload: the row exists, the bytes do not. PUT them to `uploadUrl`
 * — a presigned S3 URL that carries no ERP credentials and expires — then
 * complete the file. {@link FilesApi.upload} does all three.
 */
export interface FileUploadDto {
  file: FileDto;
  uploadUrl: string;
  expiresInSeconds: number;
}

export interface FileDownloadDto {
  downloadUrl: string;
  expiresInSeconds: number;
}

/** Sharing on a file or a folder — the ACL endpoints answer with this. */
export interface FileSharingDto {
  visibility: FileVisibility;
  entries: SharingEntry[];
  fileId?: string;
  folderId?: string;
}

/**
 * One **deletion**, not one deleted row: a folder that took a subtree with it
 * appears once, and restoring or purging it takes the subtree along.
 */
export interface TrashItemDto {
  id: string;
  type: "file" | "folder" | (string & {});
  name: string;
  parentId?: string;
  mimeType?: string;
  sizeBytes: number;
  deletedBy?: string;
  deletedAt: string;
  /** When the sweep removes it and the stored bytes for good. */
  purgeAt: string;
}

/** One bounded pass of emptying the trash. `hasMore`: call again for the rest. */
export interface EmptyTrashResult {
  purged: number;
  /** Deletions the caller may not finish — somebody else's — left alone. */
  skipped: number;
  freedBytes: number;
  hasMore: boolean;
}

/** What a wiki page is *for*, which is also how the catalog groups it. */
export type WikiPageType = "entity" | "concept" | "comparison" | "query";

/** `draft` until published; `archived` retires it without breaking links. */
export type WikiPageStatus = "draft" | "published" | "archived" | (string & {});

export type WikiConfidence = "high" | "medium" | "low";

/** Raw material a page cites. `file` sources are attached drive documents. */
export type WikiSourceKind = "article" | "paper" | "transcript" | "note";

export interface WikiPageDto {
  id: string;
  workspaceId: string;
  createdBy?: string;
  updatedBy?: string;
  /** The page's address — every other call takes this, not the id. */
  slug: string;
  title: string;
  type: WikiPageType | (string & {});
  summary: string;
  tags: string[];
  confidence?: WikiConfidence;
  /** The workspace does not agree on this page yet. Lint reports it. */
  contested: boolean;
  status: WikiPageStatus;
  createdAt: string;
  updatedAt: string;
}

/** A `[[slug]]` link out of or into a page. `resolved: false` is a broken link. */
export interface WikiPageLink {
  slug: string;
  title?: string;
  resolved: boolean;
}

export interface WikiPageDetailDto extends WikiPageDto {
  body: string;
  sources: WikiSourceDto[];
  outbound: WikiPageLink[];
  inbound: WikiPageLink[];
  passages?: WikiPassageDto[];
}

export interface WikiSourceDto {
  id: string;
  workspaceId: string;
  createdBy?: string;
  kind: WikiSourceKind | (string & {});
  title: string;
  sourceUrl: string;
  sha256: string;
  sizeBytes: number;
  createdAt: string;
  /** Set on a source that came from a drive file, not from pasted text. */
  fileId?: string;
  mimeType?: string;
  pageCount?: number;
  /** Indexing is queued: `pending` → `ready`, or `failed` with `indexError`. */
  indexStatus?: string;
  indexError?: string;
}

export interface WikiSourceDetailDto extends WikiSourceDto {
  body: string;
  /** The pages compiled from this source. */
  pages: WikiPageDto[];
}

/**
 * One retrieved chunk of an attached document — what `ask` answers with.
 * `link` points back at the page and passage so a citation is clickable.
 */
export interface WikiPassageDto {
  kind: string;
  text: string;
  /** The source's title, ready to be cited. */
  source: string;
  sourceId: string;
  fileId?: string;
  headingPath?: string;
  pageNumber?: number;
  imageUrl?: string;
  link?: string;
  score: number;
}

export interface WikiCatalogEntry {
  slug: string;
  title: string;
  summary: string;
  status: WikiPageStatus;
  tags: string[];
  updatedAt: string;
}

/** The whole wiki, grouped by page type. Generated per request. */
export interface WikiCatalogDto {
  totalPages: number;
  sections: Record<string, WikiCatalogEntry[]>;
}

export interface WikiPageMatchDto {
  slug: string;
  title: string;
  type: WikiPageType | (string & {});
  summary: string;
  status: WikiPageStatus;
  rank: number;
}

export interface WikiLintFinding {
  kind: string;
  severity: string;
  /** The page slug or tag the finding is about. */
  subject: string;
  detail: string;
}

export interface WikiLintReportDto {
  totalPages: number;
  totalSources: number;
  findings: WikiLintFinding[];
  lintedAt: string;
}

/** The house style every page is held to, and what lint measures against. */
export interface WikiSettingsDto {
  workspaceId: string;
  domain: string;
  conventions: string;
  taxonomy: string[];
  lintedAt?: string;
}

export interface WikiLogEntryDto {
  id: string;
  userId?: string;
  action: string;
  subject: string;
  details: Record<string, unknown>;
  createdAt: string;
}
