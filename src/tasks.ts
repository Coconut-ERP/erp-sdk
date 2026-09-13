import {
  DryRunUnsupportedError,
  ErpApiError,
  TaskBoardError,
  UnknownTaskError,
} from "./errors";
import type { Http, HttpOptions } from "./http";
import type { WriteOptions } from "./objects";
import type {
  PageMeta,
  TaskActor,
  TaskActorType,
  TaskBoardDetailDto,
  TaskBoardDto,
  TaskCommentDto,
  TaskDetailDto,
  TaskDto,
  TaskPriority,
  TaskStatus,
  TaskTagDto,
} from "./types";

export const TASK_STATUSES: readonly TaskStatus[] = [
  "todo",
  "in_progress",
  "review",
  "done",
  "archived",
];

export const TASK_PRIORITIES: readonly TaskPriority[] = [
  "low",
  "medium",
  "high",
  "urgent",
];

export const TASK_ACTOR_TYPES: readonly TaskActorType[] = ["user", "agent"];

export const MAX_TASK_TITLE_LENGTH = 500;
export const MAX_TASK_DESCRIPTION_LENGTH = 100_000;
export const MAX_TASK_COMMENT_LENGTH = 100_000;
export const MAX_TASK_TAGS = 50;
export const MAX_TASK_TAG_NAME_LENGTH = 100;
export const MAX_TASK_BOARD_NAME_LENGTH = 255;
export const MAX_TASK_BOARD_DESCRIPTION_LENGTH = 5_000;
export const MAX_TASK_ATTACHMENT_URL_LENGTH = 1_024;

const RFC3339 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const HEX_COLOR =
  /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export type TaskTag = string | { name: string; color?: string };

export interface TaskAuthor {
  type: TaskActorType;
  id?: string;
}

export interface TaskSpec {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignee?: TaskActor;
  dueDate?: string | Date;
  tags?: TaskTag[];
  metadata?: Record<string, unknown>;
  actor?: TaskAuthor;
}

export interface TaskChanges {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | Date;
  metadata?: Record<string, unknown>;
}

export interface TaskBoardChanges {
  name?: string;
  description?: string;
}

export interface TaskCommentSpec {
  content: string;
  attachmentUrl?: string;
  actor?: TaskAuthor;
}

export interface ListTasksOptions {
  status?: TaskStatus;
  priority?: TaskPriority;
  assignee?: TaskActor;
  unassigned?: boolean;
  tag?: string;
  page?: number;
  perPage?: number;
}

export interface TaskBoardApiOptions extends WriteOptions {
  serviceAccount?: boolean;
}

function checkLength(
  field: string,
  value: string | undefined,
  max: number,
): void {
  if (value !== undefined && [...value].length > max) {
    throw new TaskBoardError(field, `longer than ${max} characters`);
  }
}

function checkEnum<T extends string>(
  field: string,
  value: T | undefined,
  allowed: readonly T[],
): void {
  if (value !== undefined && !allowed.includes(value)) {
    throw new TaskBoardError(
      field,
      `"${value}" is not one of ${allowed.join(", ")}`,
    );
  }
}

function toDueDate(value: string | Date | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TaskBoardError("dueDate", "is an invalid Date");
    }
    return value.toISOString();
  }
  if (!RFC3339.test(value) || Number.isNaN(Date.parse(value))) {
    throw new TaskBoardError(
      "dueDate",
      `"${value}" is not a full RFC 3339 timestamp — send ` +
        `"2026-09-20T17:00:00+07:00", or pass a Date`,
    );
  }
  return value;
}

function toTag(tag: TaskTag): { name: string; color?: string } {
  const spec = typeof tag === "string" ? { name: tag } : tag;
  if (spec.name === "") {
    throw new TaskBoardError("tags", "a tag name is empty");
  }
  checkLength("tags", spec.name, MAX_TASK_TAG_NAME_LENGTH);
  if (spec.color === undefined) return { name: spec.name };
  if (!HEX_COLOR.test(spec.color)) {
    throw new TaskBoardError(
      "tags",
      `color "${spec.color}" is not a hex color like #F59E0B`,
    );
  }
  return { name: spec.name, color: spec.color };
}

function toActor(actor: TaskAuthor | undefined): TaskAuthor | undefined {
  if (!actor) return undefined;
  checkEnum("actor", actor.type, TASK_ACTOR_TYPES);
  if (actor.type === "agent" && !actor.id) {
    throw new TaskBoardError("actor", "an agent actor needs its id");
  }
  return actor;
}

function toAssignee(assignee: TaskActor | null | undefined): {
  assignedTo?: string;
  assignedToType?: TaskActorType;
} {
  if (!assignee) return {};
  checkEnum("assignee", assignee.type, TASK_ACTOR_TYPES);
  if (!assignee.id) {
    throw new TaskBoardError("assignee", "needs an id");
  }
  return { assignedTo: assignee.id, assignedToType: assignee.type };
}

function checkTaskFields(fields: TaskChanges): void {
  if (fields.title !== undefined && fields.title === "") {
    throw new TaskBoardError("title", "cannot be empty");
  }
  checkLength("title", fields.title, MAX_TASK_TITLE_LENGTH);
  checkLength("description", fields.description, MAX_TASK_DESCRIPTION_LENGTH);
  checkEnum("status", fields.status, TASK_STATUSES);
  checkEnum("priority", fields.priority, TASK_PRIORITIES);
}

export class TaskBoardApi {
  private boardId?: string;

  constructor(
    private readonly http: Http,
    private readonly options: TaskBoardApiOptions = {},
  ) {}

  async board(): Promise<TaskBoardDetailDto> {
    const id = await this.ownBoardId();
    return this.request<TaskBoardDetailDto>("GET", `/ai-task/boards/${id}`);
  }

  async updateBoard(changes: TaskBoardChanges): Promise<TaskBoardDto> {
    if (changes.name === undefined && changes.description === undefined) {
      throw new TaskBoardError(
        "changes",
        "nothing to change — pass name or description",
      );
    }
    if (changes.name === "") {
      throw new TaskBoardError("name", "cannot be empty");
    }
    checkLength("name", changes.name, MAX_TASK_BOARD_NAME_LENGTH);
    checkLength(
      "description",
      changes.description,
      MAX_TASK_BOARD_DESCRIPTION_LENGTH,
    );
    const id = await this.ownBoardId();
    return this.request<TaskBoardDto>("PATCH", `/ai-task/boards/${id}`, {
      body: changes,
    });
  }

  async list(
    options: ListTasksOptions = {},
  ): Promise<{ tasks: TaskDto[]; meta?: PageMeta }> {
    checkEnum("status", options.status, TASK_STATUSES);
    checkEnum("priority", options.priority, TASK_PRIORITIES);
    checkLength("tag", options.tag, MAX_TASK_TAG_NAME_LENGTH);
    const assignee = toAssignee(options.assignee);
    const id = await this.ownBoardId();
    this.assertMember();
    const paged = await this.http.requestPaged<TaskDto[]>(
      "GET",
      `/ai-task/boards/${id}/tasks`,
      {
        query: {
          status: options.status,
          priority: options.priority,
          assignedTo: assignee.assignedTo,
          assignedToType: assignee.assignedToType,
          unassigned: options.unassigned,
          tag: options.tag,
          page: options.page,
          perPage: options.perPage,
        },
      },
    );
    return { tasks: paged.data ?? [], meta: paged.meta };
  }

  async listAll(
    options: Omit<ListTasksOptions, "page"> = {},
  ): Promise<TaskDto[]> {
    const perPage = options.perPage ?? 100;
    const first = await this.list({ ...options, page: 1, perPage });
    const all = [...first.tasks];
    const pages = first.meta?.totalPages ?? 1;
    for (let page = 2; page <= pages; page++) {
      all.push(...(await this.list({ ...options, page, perPage })).tasks);
    }
    return all;
  }

  async create(spec: TaskSpec): Promise<TaskDto> {
    if (!spec.title) {
      throw new TaskBoardError("title", "is required");
    }
    checkTaskFields(spec);
    if (spec.tags && spec.tags.length > MAX_TASK_TAGS) {
      throw new TaskBoardError(
        "tags",
        `${spec.tags.length} tags, at most ${MAX_TASK_TAGS}`,
      );
    }
    const body = {
      title: spec.title,
      description: spec.description,
      status: spec.status,
      priority: spec.priority,
      ...toAssignee(spec.assignee),
      dueDate: toDueDate(spec.dueDate),
      tags: spec.tags?.map(toTag),
      metadata: spec.metadata,
      actor: toActor(spec.actor),
    };
    const id = await this.ownBoardId();
    return this.request<TaskDto>("POST", `/ai-task/boards/${id}/tasks`, {
      body,
    });
  }

  async get(taskId: string): Promise<TaskDetailDto> {
    return this.taskCall<TaskDetailDto>("GET", taskId, "");
  }

  async update(taskId: string, changes: TaskChanges): Promise<TaskDto> {
    const sent = Object.values(changes).some((value) => value !== undefined);
    if (!sent) {
      throw new TaskBoardError("changes", "nothing to change");
    }
    checkTaskFields(changes);
    return this.taskCall<TaskDto>("PATCH", taskId, "", {
      body: { ...changes, dueDate: toDueDate(changes.dueDate) },
    });
  }

  async setStatus(taskId: string, status: TaskStatus): Promise<TaskDto> {
    checkEnum("status", status, TASK_STATUSES);
    return this.taskCall<TaskDto>("PATCH", taskId, "/status", {
      body: { status },
    });
  }

  async assign(taskId: string, assignee: TaskActor | null): Promise<TaskDto> {
    return this.taskCall<TaskDto>("PATCH", taskId, "/assign", {
      body: toAssignee(assignee),
    });
  }

  async delete(taskId: string, options: WriteOptions = {}): Promise<void> {
    if (options.dryRun ?? this.options.dryRun ?? false) {
      throw new DryRunUnsupportedError(`deleting task "${taskId}"`);
    }
    await this.taskCall<unknown>("DELETE", taskId, "");
  }

  async comments(taskId: string): Promise<TaskCommentDto[]> {
    return (
      (await this.taskCall<TaskCommentDto[]>("GET", taskId, "/comments")) ?? []
    );
  }

  async comment(
    taskId: string,
    spec: string | TaskCommentSpec,
  ): Promise<TaskCommentDto> {
    const comment = typeof spec === "string" ? { content: spec } : spec;
    if (!comment.content) {
      throw new TaskBoardError("content", "is required");
    }
    checkLength("content", comment.content, MAX_TASK_COMMENT_LENGTH);
    if (comment.attachmentUrl !== undefined) {
      checkLength(
        "attachmentUrl",
        comment.attachmentUrl,
        MAX_TASK_ATTACHMENT_URL_LENGTH,
      );
      try {
        new URL(comment.attachmentUrl);
      } catch {
        throw new TaskBoardError(
          "attachmentUrl",
          `"${comment.attachmentUrl}" is not an absolute URL`,
        );
      }
    }
    return this.taskCall<TaskCommentDto>("POST", taskId, "/comments", {
      body: {
        content: comment.content,
        attachmentUrl: comment.attachmentUrl,
        actor: toActor(comment.actor),
      },
    });
  }

  async deleteComment(
    taskId: string,
    commentId: string,
    options: WriteOptions = {},
  ): Promise<void> {
    if (options.dryRun ?? this.options.dryRun ?? false) {
      throw new DryRunUnsupportedError(
        `deleting comment "${commentId}" on task "${taskId}"`,
      );
    }
    await this.request<unknown>(
      "DELETE",
      `/ai-task/tasks/${taskId}/comments/${commentId}`,
    );
  }

  async addTag(taskId: string, tag: TaskTag): Promise<TaskTagDto[]> {
    return (
      (await this.taskCall<TaskTagDto[]>("POST", taskId, "/tags", {
        body: toTag(tag),
      })) ?? []
    );
  }

  async removeTag(taskId: string, name: string): Promise<void> {
    await this.request<unknown>(
      "DELETE",
      `/ai-task/tasks/${taskId}/tags/${encodeURIComponent(name)}`,
    );
  }

  private assertMember(): void {
    if (this.options.serviceAccount) {
      throw new TaskBoardError(
        "credential",
        "a service account key (erp_sk_…) has no board — only a member's " +
          "session or personal key (erp_uk_…) reaches one; from a mini app " +
          "use session(initData).client or asUser(accessToken)",
      );
    }
  }

  private async ownBoardId(): Promise<string> {
    if (!this.boardId) {
      const boards = await this.request<TaskBoardDto[]>(
        "GET",
        "/ai-task/boards",
      );
      const board = boards?.[0];
      if (!board) {
        throw new Error(
          "GET /ai-task/boards returned no board for this member",
        );
      }
      this.boardId = board.id;
    }
    return this.boardId;
  }

  private async request<T>(
    method: string,
    path: string,
    options: HttpOptions = {},
  ): Promise<T> {
    this.assertMember();
    return this.http.request<T>(method, path, options);
  }

  private async taskCall<T>(
    method: string,
    taskId: string,
    suffix: string,
    options: HttpOptions = {},
  ): Promise<T> {
    try {
      return await this.request<T>(
        method,
        `/ai-task/tasks/${taskId}${suffix}`,
        options,
      );
    } catch (error) {
      if (error instanceof ErpApiError && error.status === 404) {
        throw new UnknownTaskError(taskId);
      }
      throw error;
    }
  }
}
