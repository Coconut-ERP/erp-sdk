import {
  DryRunUnsupportedError,
  UnknownWorkflowError,
  WorkflowDefinitionError,
  WorkflowRunFailedError,
  WorkflowRunTimeoutError,
} from "./errors";
import type { Http } from "./http";
import type { WriteOptions } from "./objects";
import { resolveByName } from "./resolve";
import type {
  CronTriggerConfig,
  SharingDto,
  SharingEntry,
  SharingVisibility,
  WorkflowDto,
  WorkflowRunDto,
  WorkflowRunOutput,
  WorkflowTrigger,
  WorkflowTriggerType,
} from "./types";

/** Every trigger the backend accepts today. `webhook`/`event` do not exist. */
export const WORKFLOW_TRIGGER_TYPES: readonly WorkflowTriggerType[] = [
  "manual",
  "cron",
];

/** Statuses that mean the run has not finished yet. */
export const WORKFLOW_RUN_PENDING_STATUSES: readonly string[] = [
  "ENQUEUED",
  "PENDING",
  "RUNNING",
  "RETRY",
];

/**
 * Sent as an env **value** to keep whatever is already stored under that name.
 * `PUT /env` replaces the whole map, and a stored value can never be read back,
 * so adding one entry means resending every other name with this sentinel.
 */
export const WORKFLOW_ENV_KEEP = "[KEEP]";

/** Server cap on how many env entries one workflow may carry. */
export const MAX_WORKFLOW_ENV_ENTRIES = 50;

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The runner only exposes `main` — anything else is code the server rejects. */
const MAIN_FUNCTION = /\bmain\s*\(/;

const DEFAULT_RUN_TIMEOUT_MS = 120_000;
const DEFAULT_RUN_POLL_MS = 1_000;

/** A finished run: nothing further will change on it. */
export function isRunFinished(status: string): boolean {
  return !WORKFLOW_RUN_PENDING_STATUSES.includes(status);
}

/**
 * `run.output` is a JSON **string** the runner packs — `{ workflowId, version,
 * result, logs, durationMs }`. Undefined when it is absent or unparseable
 * (a failed run carries its message in `run.error` instead).
 */
export function runOutput<T = unknown>(
  run: WorkflowRunDto,
): WorkflowRunOutput<T> | undefined {
  if (!run.output) return undefined;
  try {
    return JSON.parse(run.output) as WorkflowRunOutput<T>;
  } catch {
    return undefined;
  }
}

/** What `main()` returned, straight out of {@link runOutput}. */
export function runResult<T = unknown>(run: WorkflowRunDto): T | undefined {
  return runOutput<T>(run)?.result;
}

/** `console.log` lines the run collected, if the runner kept any. */
export function runLogs(run: WorkflowRunDto): string[] {
  return runOutput(run)?.logs ?? [];
}

/**
 * Client-side half of what `POST /workflows` validates, so the common mistakes
 * cost no round trip: an unsupported trigger, a five-field cron (the server
 * wants seconds too), or code with no `main()`.
 */
export function assertWorkflowTrigger(trigger: WorkflowTrigger): void {
  if (!WORKFLOW_TRIGGER_TYPES.includes(trigger.type as WorkflowTriggerType)) {
    throw new WorkflowDefinitionError(
      "trigger",
      `"${trigger.type}" is not a trigger type — only ` +
        `${WORKFLOW_TRIGGER_TYPES.join(", ")} exist`,
    );
  }
  if (trigger.type !== "cron") return;

  const config = (trigger.config ?? {}) as Partial<CronTriggerConfig>;
  if (!config.schedule || !config.timezone) {
    throw new WorkflowDefinitionError(
      "trigger",
      "a cron trigger needs config.schedule and config.timezone, e.g. " +
        '{ schedule: "0 0 9 * * *", timezone: "Asia/Ho_Chi_Minh" }',
    );
  }
  const schedule = config.schedule.trim();
  if (schedule.startsWith("@")) return;
  const fields = schedule.split(/\s+/).length;
  if (fields !== 6) {
    throw new WorkflowDefinitionError(
      "trigger",
      `cron schedule "${schedule}" has ${fields} fields — ` +
        'this scheduler wants 6 (seconds first): "0 0 9 * * *" is 09:00 daily. ' +
        "Descriptors (@daily, @every 1h) work too",
    );
  }
}

export function assertWorkflowCode(code: string): void {
  if (!MAIN_FUNCTION.test(code)) {
    throw new WorkflowDefinitionError(
      "code",
      'it must define "async function main(input)" — that is the entry point ' +
        "the runner calls",
    );
  }
}

export function assertWorkflowEnv(env: Record<string, string>): void {
  const names = Object.keys(env);
  if (names.length > MAX_WORKFLOW_ENV_ENTRIES) {
    throw new WorkflowDefinitionError(
      "env",
      `${names.length} entries, but at most ${MAX_WORKFLOW_ENV_ENTRIES} are stored`,
    );
  }
  for (const name of names) {
    if (!ENV_NAME.test(name)) {
      throw new WorkflowDefinitionError(
        "env",
        `"${name}" is not a valid name — [A-Za-z_][A-Za-z0-9_]*`,
      );
    }
  }
}

export interface WorkflowSpec {
  name: string;
  code: string;
  trigger: WorkflowTrigger;
  description?: string;
  /** Secrets the script reads as `env` / `process.env`. Write-only, forever. */
  env?: Record<string, string>;
}

export interface WorkflowChanges {
  name?: string;
  description?: string;
  trigger?: WorkflowTrigger;
  code?: string;
  /** Optimistic lock. Omitted, the handle's current version is used. */
  version?: number;
}

/** Offset pagination, shared by the workflow list and a workflow's run list. */
export interface OffsetPageOptions {
  limit?: number;
  offset?: number;
}

export interface WaitForRunOptions {
  /** Give up after this long. The run keeps going. Default 120 000 ms. */
  timeoutMs?: number;
  /** Gap between polls. Default 1 000 ms. */
  intervalMs?: number;
  /** `false` returns the failed run instead of throwing. Default `true`. */
  throwOnError?: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `client.workflows` — the workspace's automation scripts. A workflow is one
 * TypeScript file exporting `async function main(input)`, versioned, published,
 * and then run either by hand or on a cron.
 */
export class WorkflowsApi {
  constructor(
    private readonly http: Http,
    private readonly options: WriteOptions = {},
  ) {}

  /** One page, newest first. The list omits each workflow's `code`. */
  async list(options: OffsetPageOptions = {}): Promise<WorkflowDto[]> {
    return (
      (await this.http.request<WorkflowDto[]>("GET", "/workflows", {
        query: { limit: options.limit, offset: options.offset },
      })) ?? []
    );
  }

  /**
   * Every workflow, by walking `offset`. The endpoint sends no total, so it
   * stops at the first empty page — a page whose every row the caller may not
   * see comes back empty and ends the walk early.
   */
  async listAll(
    options: { pageSize?: number; maxPages?: number } = {},
  ): Promise<WorkflowDto[]> {
    const pageSize = options.pageSize ?? 100;
    const maxPages = options.maxPages ?? 50;
    const all: WorkflowDto[] = [];
    for (let page = 0; page < maxPages; page++) {
      const batch = await this.list({
        limit: pageSize,
        offset: page * pageSize,
      });
      if (batch.length === 0) return all;
      all.push(...batch);
      if (batch.length < pageSize) return all;
    }
    return all;
  }

  /** The definition including `code`, by id. */
  async get(workflowId: string): Promise<WorkflowDto> {
    return this.http.request<WorkflowDto>("GET", `/workflows/${workflowId}`);
  }

  /**
   * Creates an unpublished draft. It does not run until {@link
   * WorkflowHandle.publish}. Structural, so it writes for real in development
   * mode too — only *running* a workflow is gated by the mode.
   */
  async create(spec: WorkflowSpec): Promise<WorkflowHandle> {
    assertWorkflowTrigger(spec.trigger);
    assertWorkflowCode(spec.code);
    if (spec.env) assertWorkflowEnv(spec.env);

    const dto = await this.http.request<WorkflowDto>("POST", "/workflows", {
      body: {
        name: spec.name,
        code: spec.code,
        trigger: spec.trigger,
        description: spec.description,
        env: spec.env,
      },
    });
    return new WorkflowHandle(this.http, dto, this.options);
  }

  /**
   * Resolves by id, then exact name, then case-insensitive name — the same
   * order as `client.object()` — and fetches the full definition.
   */
  async handle(nameOrId: string): Promise<WorkflowHandle> {
    const workflows = await this.listAll();
    const found = resolveByName(workflows, nameOrId);
    if (!found) {
      throw new UnknownWorkflowError(
        nameOrId,
        workflows.map((w) => w.name),
      );
    }
    return new WorkflowHandle(
      this.http,
      await this.get(found.id),
      this.options,
    );
  }
}

/** One workflow: its definition, its env, its sharing, and its runs. */
export class WorkflowHandle {
  constructor(
    private readonly http: Http,
    private dto: WorkflowDto,
    private readonly options: WriteOptions = {},
  ) {}

  get id(): string {
    return this.dto.id;
  }

  get name(): string {
    return this.dto.name;
  }

  /** Optimistic lock — bumped by every mutation, including `publish`. */
  get version(): number {
    return this.dto.version;
  }

  get status(): string {
    return this.dto.status;
  }

  /** `false` while the workflow is a draft — runs would have nothing to execute. */
  get isPublished(): boolean {
    return this.dto.status === "active";
  }

  get trigger(): WorkflowTrigger {
    return this.dto.trigger;
  }

  get code(): string {
    return this.dto.code ?? "";
  }

  /** Env **names** only. Values read back as `***` and can never be recovered. */
  get envNames(): string[] {
    return Object.keys(this.dto.env ?? {});
  }

  /** The raw definition as the server last returned it. */
  get meta(): WorkflowDto {
    return this.dto;
  }

  async refresh(): Promise<WorkflowDto> {
    this.dto = await this.http.request<WorkflowDto>(
      "GET",
      `/workflows/${this.id}`,
    );
    return this.dto;
  }

  /**
   * Any change returns the workflow to **draft** — publish again or nothing
   * new runs.
   */
  async update(changes: WorkflowChanges): Promise<WorkflowDto> {
    if (changes.trigger) assertWorkflowTrigger(changes.trigger);
    if (changes.code !== undefined) assertWorkflowCode(changes.code);
    this.dto = await this.http.request<WorkflowDto>(
      "PUT",
      `/workflows/${this.id}`,
      {
        body: { ...changes, version: changes.version ?? this.version },
      },
    );
    return this.dto;
  }

  /** Makes a version the one new runs execute. */
  async publish(version?: number): Promise<WorkflowDto> {
    this.dto = await this.http.request<WorkflowDto>(
      "POST",
      `/workflows/${this.id}/publish`,
      { body: { version: version ?? this.version } },
    );
    return this.dto;
  }

  /**
   * Replaces the env **whole**: a name this map omits is dropped. Keep an
   * existing value you cannot read by sending {@link WORKFLOW_ENV_KEEP} for it.
   * Does not bump the version, return the workflow to draft, or retire its
   * cron — the next run just picks the new values up.
   */
  async setEnv(env: Record<string, string>): Promise<WorkflowDto> {
    assertWorkflowEnv(env);
    this.dto = await this.http.request<WorkflowDto>(
      "PUT",
      `/workflows/${this.id}/env`,
      { body: { env } },
    );
    return this.dto;
  }

  async sharing(): Promise<SharingDto> {
    return this.http.request<SharingDto>("GET", `/workflows/${this.id}/acl`);
  }

  /** Entries are only accepted with `restricted` visibility. */
  async setSharing(
    visibility: SharingVisibility,
    entries: SharingEntry[] = [],
  ): Promise<SharingDto> {
    return this.http.request<SharingDto>("PUT", `/workflows/${this.id}/acl`, {
      body: { visibility, entries },
    });
  }

  async delete(version?: number): Promise<void> {
    await this.http.request<unknown>("DELETE", `/workflows/${this.id}`, {
      query: { version: version ?? this.version },
    });
  }

  /**
   * Starts a run of the **published** version and returns immediately — the
   * run is queued, so its status is `ENQUEUED`. `input` is what `main(input)`
   * receives, and the script executes under the caller's permissions.
   *
   * A run writes real data and the server has no dry run for it, so in
   * development mode this throws {@link DryRunUnsupportedError} rather than
   * quietly doing the real thing. `{ dryRun: false }` runs it anyway.
   */
  async run(
    input: Record<string, unknown> = {},
    options: WriteOptions = {},
  ): Promise<WorkflowRunDto> {
    if (options.dryRun ?? this.options.dryRun ?? false) {
      throw new DryRunUnsupportedError(`workflow run (${this.name})`);
    }
    return this.http.request<WorkflowRunDto>(
      "POST",
      `/workflows/${this.id}/runs`,
      {
        body: { input },
      },
    );
  }

  async runs(options: OffsetPageOptions = {}): Promise<WorkflowRunDto[]> {
    return (
      (await this.http.request<WorkflowRunDto[]>(
        "GET",
        `/workflows/${this.id}/runs`,
        { query: { limit: options.limit, offset: options.offset } },
      )) ?? []
    );
  }

  async getRun(runId: string): Promise<WorkflowRunDto> {
    return this.http.request<WorkflowRunDto>(
      "GET",
      `/workflows/${this.id}/runs/${encodeURIComponent(runId)}`,
    );
  }

  /**
   * Polls until the run finishes. Throws {@link WorkflowRunFailedError} on
   * `ERROR` (the message carries what the script threw, plus its logs) and
   * {@link WorkflowRunTimeoutError} if it is still going when time runs out —
   * timing out does not stop the run.
   */
  async waitForRun(
    runId: string,
    options: WaitForRunOptions = {},
  ): Promise<WorkflowRunDto> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
    const intervalMs = options.intervalMs ?? DEFAULT_RUN_POLL_MS;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const run = await this.getRun(runId);
      if (isRunFinished(run.status)) {
        if (run.status === "ERROR" && (options.throwOnError ?? true)) {
          throw new WorkflowRunFailedError(this.name, run);
        }
        return run;
      }
      if (Date.now() >= deadline) {
        throw new WorkflowRunTimeoutError(this.name, run, timeoutMs);
      }
      await sleep(intervalMs);
    }
  }

  /** {@link run} then {@link waitForRun} — the usual way to call a workflow. */
  async runAndWait(
    input: Record<string, unknown> = {},
    options: WaitForRunOptions & WriteOptions = {},
  ): Promise<WorkflowRunDto> {
    const started = await this.run(input, { dryRun: options.dryRun });
    return this.waitForRun(started.id, options);
  }
}
