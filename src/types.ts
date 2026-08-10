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

export interface BulkCreateRecordsRequest {
  records: Array<{ data: Record<string, unknown> }>;
}

export interface BulkCreateRecordsResult {
  created: number;
  records: RecordDto[];
}

export interface BulkUpdateRecordsRequest {
  filters?: RecordFilter[];
  data: Record<string, unknown>;
  limit?: number;
}

export interface BulkUpdateRecordsResult {
  matched: number;
  updated: number;
  hasMore: boolean;
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
