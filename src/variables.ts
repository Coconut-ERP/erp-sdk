import {
  DryRunUnsupportedError,
  ErpApiError,
  UnknownWorkflowVariableError,
  WorkflowDefinitionError,
} from "./errors";
import type { Http } from "./http";
import type { WriteOptions } from "./objects";
import type { WorkflowVariableDto } from "./types";

/** Server cap on a value. They hold text — a record belongs in an object. */
export const MAX_WORKFLOW_VARIABLE_LENGTH = 16_384;

/** Server cap on how many workflows one variable may be shared with. */
export const MAX_WORKFLOW_VARIABLE_WORKFLOWS = 100;

/** What the server accepts as a key, and what a script types to read one. */
const VARIABLE_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;

export function assertWorkflowVariableKey(key: string): void {
  if (!VARIABLE_KEY.test(key)) {
    throw new WorkflowDefinitionError(
      "variable",
      `"${key}" is not a valid key — it starts with a letter and holds ` +
        "letters, digits, dots, dashes and underscores, up to 128 characters",
    );
  }
}

function assertWorkflowVariableValue(key: string, value: string): void {
  if (value.length > MAX_WORKFLOW_VARIABLE_LENGTH) {
    throw new WorkflowDefinitionError(
      "variable",
      `"${key}" is ${value.length} characters, but at most ` +
        `${MAX_WORKFLOW_VARIABLE_LENGTH} are stored — keep a cursor here and ` +
        "the data itself in an object",
    );
  }
}

function assertWorkflowVariableWorkflows(workflowIds: string[]): void {
  if (workflowIds.length > MAX_WORKFLOW_VARIABLE_WORKFLOWS) {
    throw new WorkflowDefinitionError(
      "variable",
      `${workflowIds.length} workflows, but at most ` +
        `${MAX_WORKFLOW_VARIABLE_WORKFLOWS} may share one variable`,
    );
  }
}

export interface WorkflowVariableSpec {
  key: string;
  value?: string;
  description?: string;
  /**
   * The workflows whose runs may read **and** write it — there is no separate
   * read and write grant. Omitted or empty, no run reaches it.
   */
  workflowIds?: string[];
}

export interface WorkflowVariableChanges {
  value?: string;
  description?: string;
  /** Replaces the access list whole, the way `setEnv` replaces the env. */
  workflowIds?: string[];
}

/**
 * `client.variables` — the workspace's shared key/value store for workflows: a
 * place one run leaves what the next run reads, a checkpoint or a cursor.
 *
 * It is **not** a workflow's env, and the two are opposites. An env value is a
 * credential: write-only, encrypted, masked as `***` forever, belonging to one
 * workflow. A variable is plain text, reads back as it was written, and is
 * deliberately shared by several workflows. Anything secret stays in env.
 *
 * Each variable names the workflows allowed to touch it. Inside a run that list
 * is enforced against the run's own token, so a script reaches the variables its
 * workflow was granted and no others — an ungranted key is a 404, the same
 * answer a key that does not exist gives. A run may also only set a **value**:
 * creating, deleting and re-scoping are the workspace's decisions, made from a
 * person's own session.
 */
export class WorkflowVariablesApi {
  constructor(
    private readonly http: Http,
    private readonly options: WriteOptions = {},
  ) {}

  /** Every variable the caller may see, by key. Inside a run: the granted ones. */
  async list(): Promise<WorkflowVariableDto[]> {
    return (
      (await this.http.request<WorkflowVariableDto[]>(
        "GET",
        "/workflows/variables",
      )) ?? []
    );
  }

  /**
   * One variable, with its access list. Throws
   * {@link UnknownWorkflowVariableError} when the key does not exist *or* the
   * calling workflow was not granted it — the server does not distinguish, so
   * neither does this.
   */
  async get(key: string): Promise<WorkflowVariableDto> {
    assertWorkflowVariableKey(key);
    try {
      return await this.http.request<WorkflowVariableDto>(
        "GET",
        `/workflows/variables/${encodeURIComponent(key)}`,
      );
    } catch (error) {
      if (error instanceof ErpApiError && error.status === 404) {
        throw new UnknownWorkflowVariableError(key);
      }
      throw error;
    }
  }

  /**
   * The value alone, or `undefined` when there is none to read — which is what
   * a checkpoint's first run finds:
   *
   * ```ts
   * const since = (await erp.variables.value("invoice.cursor")) ?? "2026-01-01";
   * ```
   */
  async value(key: string): Promise<string | undefined> {
    try {
      return (await this.get(key)).value;
    } catch (error) {
      if (error instanceof UnknownWorkflowVariableError) return undefined;
      throw error;
    }
  }

  /**
   * Moves a variable's value and nothing else — the one write a workflow run
   * may make, and the usual last line of a script that keeps a cursor.
   */
  async set(
    key: string,
    value: string,
    options: WriteOptions = {},
  ): Promise<WorkflowVariableDto> {
    return this.update(key, { value }, options);
  }

  /**
   * Declares a variable. `workflowIds` is what makes it reachable at all, and
   * every id must be a workflow of this workspace. A run cannot create one.
   */
  async create(
    spec: WorkflowVariableSpec,
    options: WriteOptions = {},
  ): Promise<WorkflowVariableDto> {
    assertWorkflowVariableKey(spec.key);
    if (spec.value !== undefined) {
      assertWorkflowVariableValue(spec.key, spec.value);
    }
    if (spec.workflowIds) assertWorkflowVariableWorkflows(spec.workflowIds);
    this.assertWritable(spec.key, options);

    return this.http.request<WorkflowVariableDto>(
      "POST",
      "/workflows/variables",
      {
        body: {
          key: spec.key,
          value: spec.value ?? "",
          description: spec.description,
          workflowIds: spec.workflowIds ?? [],
        },
      },
    );
  }

  /**
   * Changes only the fields it carries. Last writer wins — there is no version
   * check, because a checkpoint wants the newest write and not a conflict.
   */
  async update(
    key: string,
    changes: WorkflowVariableChanges,
    options: WriteOptions = {},
  ): Promise<WorkflowVariableDto> {
    assertWorkflowVariableKey(key);
    if (
      changes.value === undefined &&
      changes.description === undefined &&
      changes.workflowIds === undefined
    ) {
      throw new WorkflowDefinitionError(
        "variable",
        `"${key}" was updated with no changes — pass value, description or ` +
          "workflowIds",
      );
    }
    if (changes.value !== undefined) {
      assertWorkflowVariableValue(key, changes.value);
    }
    if (changes.workflowIds) {
      assertWorkflowVariableWorkflows(changes.workflowIds);
    }
    this.assertWritable(key, options);

    try {
      return await this.http.request<WorkflowVariableDto>(
        "PUT",
        `/workflows/variables/${encodeURIComponent(key)}`,
        { body: changes },
      );
    } catch (error) {
      if (error instanceof ErpApiError && error.status === 404) {
        throw new UnknownWorkflowVariableError(key);
      }
      throw error;
    }
  }

  /** Removes it and frees the key. A run cannot delete one. */
  async delete(key: string, options: WriteOptions = {}): Promise<void> {
    assertWorkflowVariableKey(key);
    this.assertWritable(key, options);
    await this.http.request<unknown>(
      "DELETE",
      `/workflows/variables/${encodeURIComponent(key)}`,
    );
  }

  /**
   * A variable write has no dry run on the server, and letting one through in
   * development mode would move the cursor a rehearsal is meant not to touch —
   * so it refuses, the same way starting a workflow run does.
   */
  private assertWritable(key: string, options: WriteOptions): void {
    if (options.dryRun ?? this.options.dryRun ?? false) {
      throw new DryRunUnsupportedError(`shared variable write (${key})`);
    }
  }
}
