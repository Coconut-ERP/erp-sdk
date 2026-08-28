import {
  type DashboardHandle,
  DashboardsApi,
  type QueryResult,
  type SqlOptions,
} from "./dashboards";
import {
  MissingPermissionsError,
  type SchemaGap,
  SchemaMismatchError,
  UnknownObjectError,
} from "./errors";
import { FilesApi } from "./files";
import { FetchHttp, type Http } from "./http";
import { type ErpMode, isDryRunMode, resolveMode } from "./mode";
import { ObjectHandle } from "./objects";
import { isAllowed, missingPermissions } from "./permissions";
import { resolveByName } from "./resolve";
import {
  type MiniAppSchema,
  planSchema,
  type SchemaObjectPlan,
  type WorkspaceObjectShape,
} from "./schema";
import type {
  EnsureFieldSpec,
  FieldDto,
  MiniAppInitData,
  MiniAppSessionDto,
  ObjectDto,
  PermissionDto,
  RequiredPermission,
  UserDto,
} from "./types";
import { WorkflowVariablesApi } from "./variables";
import { WikiApi, type WikiPageHandle } from "./wiki";
import { type WorkflowHandle, WorkflowsApi } from "./workflows";

export interface MiniAppConfig {
  baseUrl: string;
  /** API key issued from IAM — service account (erp_sk_...) or user (erp_uk_...). */
  apiKey?: string;
  /** Alternative: a user access token (JWT) for user-context apps. */
  accessToken?: string;
  /** Required with accessToken unless the user has a default workspace; ignored for API keys (the key pins its workspace). */
  workspaceId?: string;
  /** Permissions the mini app needs. Verified against the key on connect. */
  permissions?: RequiredPermission[];
  /**
   * Overrides the environment mode. Left out, `ERP_ENV` decides and anything
   * but `development` means `production` — see {@link resolveMode}.
   */
  mode?: ErpMode;
  /** Where to read `ERP_ENV` from. Defaults to `process.env`; handy in tests. */
  env?: Record<string, string | undefined>;
  fetch?: typeof globalThis.fetch;
}

export class ErpClient {
  private permissionsCache?: PermissionDto[];
  private objectsCache?: ObjectDto[];
  private meCache?: UserDto;
  private readonly handleCache = new Map<string, ObjectHandle>();

  /**
   * `production` or `development`, from `config.mode` or `ERP_ENV`. In
   * `development` every record write defaults to a server-side dry run.
   */
  readonly mode: ErpMode;

  /** Automation scripts: create, publish, run, read runs. */
  readonly workflows: WorkflowsApi;

  /** Saved SQL and ad-hoc SQL over the workspace — see {@link sql}. */
  readonly dashboards: DashboardsApi;

  /**
   * The workspace's shared key/value store for workflows — where a run leaves
   * a checkpoint the next run reads. Text only; secrets stay in a workflow's
   * env.
   */
  readonly variables: WorkflowVariablesApi;

  /**
   * The workspace's drive: folders, files, sharing and the trash. An upload is
   * three steps the SDK does in one — see {@link FilesApi.upload}.
   */
  readonly files: FilesApi;

  /**
   * The workspace's knowledge base: pages, the sources they cite, and
   * retrieval over the documents attached to them ({@link WikiApi.ask}).
   */
  readonly wiki: WikiApi;

  constructor(
    readonly http: Http,
    private readonly required: RequiredPermission[] = [],
    private readonly config?: MiniAppConfig,
    modeOverride?: ErpMode,
  ) {
    this.mode = modeOverride ?? config?.mode ?? resolveMode(config?.env);
    this.workflows = new WorkflowsApi(http, { dryRun: this.dryRun });
    this.dashboards = new DashboardsApi(http);
    this.variables = new WorkflowVariablesApi(http, { dryRun: this.dryRun });
    this.files = new FilesApi(http, {
      dryRun: this.dryRun,
      fetch: config?.fetch,
    });
    this.wiki = new WikiApi(http, { dryRun: this.dryRun });
  }

  /** Whether record writes through this client are dry runs by default. */
  get dryRun(): boolean {
    return isDryRunMode(this.mode);
  }

  /**
   * The same credentials in the other mode — for a script that rehearses its
   * writes and then commits them without being restarted:
   *
   * ```ts
   * const plan = await erp.object("Đơn hàng");              // ERP_ENV=development
   * await plan.createMany(rows);                            // rolled back
   * await (await erp.production().object("Đơn hàng")).createMany(rows);
   * ```
   *
   * Caches are not shared, so the new client re-reads objects and fields.
   */
  withMode(mode: ErpMode): ErpClient {
    if (mode === this.mode) return this;
    return new ErpClient(this.http, this.required, this.config, mode);
  }

  /** `withMode("production")` — writes land for real. */
  production(): ErpClient {
    return this.withMode("production");
  }

  /** `withMode("development")` — writes are validated and rolled back. */
  development(): ErpClient {
    return this.withMode("development");
  }

  async me(refresh = false): Promise<UserDto> {
    if (!this.meCache || refresh) {
      this.meCache = await this.http.request<UserDto>("GET", "/users/me");
    }
    return this.meCache;
  }

  /**
   * Derives a client that acts as an end user (their JWT) instead of the
   * service account. Records created through it carry the user's identity
   * and their IAM permissions/row scopes apply.
   */
  asUser(accessToken: string, workspaceId?: string): ErpClient {
    if (!this.config) {
      throw new Error("asUser requires a client created via createMiniApp");
    }
    const http = new FetchHttp({
      baseUrl: this.config.baseUrl,
      accessToken,
      workspaceId: workspaceId ?? this.config.workspaceId,
      fetch: this.config.fetch,
    });
    return new ErpClient(
      http,
      [],
      {
        ...this.config,
        apiKey: undefined,
        accessToken,
        workspaceId: workspaceId ?? this.config.workspaceId,
      },
      this.mode,
    );
  }

  async myPermissions(refresh = false): Promise<PermissionDto[]> {
    if (!this.permissionsCache || refresh) {
      this.permissionsCache = await this.http.request<PermissionDto[]>(
        "GET",
        "/iam/me/permissions",
      );
    }
    return this.permissionsCache;
  }

  async can(resource: string, action: string): Promise<boolean> {
    return isAllowed(await this.myPermissions(), resource, action);
  }

  async assertPermissions(extra?: RequiredPermission[]): Promise<void> {
    const required = [...this.required, ...(extra ?? [])];
    if (required.length === 0) return;
    const missing = missingPermissions(
      await this.myPermissions(true),
      required,
    );
    if (missing.length > 0) throw new MissingPermissionsError(missing);
  }

  async objects(refresh = false): Promise<ObjectDto[]> {
    if (!this.objectsCache || refresh) {
      this.objectsCache = await this.http.request<ObjectDto[]>(
        "GET",
        "/objects",
      );
    }
    return this.objectsCache;
  }

  async object(nameOrId: string): Promise<ObjectHandle> {
    const cached = this.handleCache.get(nameOrId);
    if (cached) return cached;

    const meta = resolveByName(await this.objects(), nameOrId);
    if (!meta) throw new UnknownObjectError(nameOrId);

    const fields = await this.http.request<FieldDto[]>(
      "GET",
      `/objects/${meta.id}/fields`,
    );
    const handle = new ObjectHandle(this.http, meta, fields ?? [], {
      dryRun: this.dryRun,
      // A renamed or regrouped object is cached under a name that no longer
      // addresses it, and in a list whose copy is now stale.
      onSchemaChange: () => this.invalidate(),
    });
    this.handleCache.set(nameOrId, handle);
    this.handleCache.set(meta.id, handle);
    return handle;
  }

  /**
   * A workflow by name or id — same resolution order as {@link object}.
   * Not cached: a workflow carries a version that every mutation bumps, so a
   * stale handle would fail its next write.
   */
  async workflow(nameOrId: string): Promise<WorkflowHandle> {
    return this.workflows.handle(nameOrId);
  }

  /** A dashboard by name or id, with its saved queries. */
  async dashboard(nameOrId: string): Promise<DashboardHandle> {
    return this.dashboards.handle(nameOrId);
  }

  /**
   * A wiki page by **slug** — the wiki's one address, since a title can move
   * and a slug does not. `wikiSlug(title)` predicts it.
   */
  async wikiPage(slug: string): Promise<WikiPageHandle> {
    return this.wiki.handle(slug);
  }

  /**
   * Runs one read-only `SELECT` over the workspace and returns columns + rows.
   *
   * Tables are object **display names** and columns are field display names
   * (`SELECT "Tổng tiền" FROM "Đơn hàng"`), plus `id`, `created_at` and
   * `updated_at` on every object. Rows are row-scoped by the caller's record
   * permissions and capped at 1 000 — aggregate in SQL rather than paginating.
   *
   * ```ts
   * const df = (await erp.sql(`
   *   SELECT "Khách hàng" AS kh, SUM("Tổng tiền") AS doanh_thu
   *   FROM "Đơn hàng" GROUP BY 1 ORDER BY 2 DESC
   * `)).toFrame();
   * ```
   */
  async sql(sql: string, options: SqlOptions = {}): Promise<QueryResult> {
    return this.dashboards.sql(sql, options);
  }

  /**
   * Diffs `schema.json` against the workspace the way the deploy-time review
   * screen does — same actions, same case-insensitive name/type comparison.
   * Useful in a health endpoint or a dev script; the review itself is a
   * backend concern (`GET /mini-apps/:appId/schema`).
   */
  async schemaPlan(
    schema: MiniAppSchema,
    options: { refresh?: boolean } = {},
  ): Promise<SchemaObjectPlan[]> {
    if (options.refresh) this.invalidate();
    const objects = await this.objects();
    const shapes: WorkspaceObjectShape[] = [];

    for (const declared of schema.objects) {
      const wanted = declared.name.trim().toLowerCase();
      const meta = objects.find((o) => o.name.toLowerCase() === wanted);
      if (!meta) continue;
      const handle = await this.object(meta.id);
      shapes.push({
        name: meta.name,
        fields: handle.fields.map((field) => ({
          name: field.name,
          type: field.type,
        })),
      });
    }
    return planSchema(schema, shapes);
  }

  /**
   * Boot-time guard: fails fast unless the workspace already holds everything
   * `schema.json` declares, and returns a handle per declared object.
   *
   * A mini app has no authority to create tables — the deployer reviews the
   * declaration and applies it. So an app that starts against an unprepared
   * workspace should stop here with one clear error, not scatter 403s and
   * "unknown field" failures across its routes.
   */
  async assertSchema(
    schema: MiniAppSchema,
    options: { refresh?: boolean } = {},
  ): Promise<Record<string, ObjectHandle>> {
    const plans = await this.schemaPlan(schema, options);
    const missing: SchemaGap[] = [];
    const conflicts: SchemaGap[] = [];

    for (const plan of plans) {
      if (plan.action === "create") {
        missing.push({ object: plan.name });
        continue;
      }
      for (const field of plan.fields) {
        if (field.action === "create") {
          missing.push({
            object: plan.name,
            field: field.name,
            type: field.type,
          });
        } else if (field.action === "conflict") {
          conflicts.push({
            object: plan.name,
            field: field.name,
            type: field.type,
            currentType: field.currentType,
          });
        }
      }
    }
    if (missing.length > 0 || conflicts.length > 0) {
      throw new SchemaMismatchError(missing, conflicts);
    }

    const handles: Record<string, ObjectHandle> = {};
    for (const declared of schema.objects) {
      handles[declared.name] = await this.object(declared.name);
    }
    return handles;
  }

  /**
   * Creates an object. Not available to a mini app, whose service account is a
   * `member` — this is for tooling run with an admin key, such as preparing a
   * workspace before installing an app.
   *
   * Structure changes have no dry run on the server, so this writes for real
   * in `development` mode too. Dry runs cover record writes only.
   */
  async createObject(
    name: string,
    options: { groups?: string[]; position?: number } = {},
  ): Promise<ObjectHandle> {
    const meta = await this.http.request<ObjectDto>("POST", "/objects", {
      body: {
        name,
        groups: options.groups ?? [],
        position: options.position ?? 0,
      },
    });
    this.objectsCache = undefined;
    const handle = new ObjectHandle(this.http, meta, [], {
      dryRun: this.dryRun,
      onSchemaChange: () => this.invalidate(),
    });
    this.handleCache.set(meta.id, handle);
    this.handleCache.set(meta.name, handle);
    return handle;
  }

  /**
   * Host-app side: mints a signed initData string identifying the current
   * user for the given mini app (service account). Pass it to the embedded
   * mini app instead of ever sharing a token.
   */
  async issueInitData(serviceAccountId: string): Promise<MiniAppInitData> {
    return this.http.request<MiniAppInitData>(
      "POST",
      "/auth/miniapp/init-data",
      { body: { serviceAccountId } },
    );
  }

  /**
   * Mini-app side: exchanges host-provided initData for a verified user and a
   * client acting as that user. The backend checks the signature, expiry, and
   * that the initData was issued for this mini app's service account.
   */
  async session(
    initData: string,
  ): Promise<{ user: UserDto; client: ErpClient; expiresIn: number }> {
    const session = await this.http.request<MiniAppSessionDto>(
      "POST",
      "/auth/miniapp/session",
      { body: { initData } },
    );
    return {
      user: session.user,
      client: this.asUser(session.accessToken),
      expiresIn: session.expiresIn,
    };
  }

  async hasObject(nameOrId: string): Promise<boolean> {
    return resolveByName(await this.objects(), nameOrId) !== undefined;
  }

  /**
   * Idempotent provisioning: returns the object if it exists (creating it
   * otherwise) and adds any of the given fields that are missing.
   *
   * Not for mini apps at boot: they may not create tables, so this throws 403
   * as soon as something is missing. Declare the tables in `schema.json` and
   * check them with {@link assertSchema} instead. Still valid for admin-key
   * tooling that prepares a workspace.
   */
  async ensureObject(
    name: string,
    fields: EnsureFieldSpec[] = [],
  ): Promise<ObjectHandle> {
    let exists = await this.hasObject(name);
    if (!exists) {
      // The cached list can predate an object someone else just created.
      await this.objects(true);
      exists = await this.hasObject(name);
    }
    const handle = exists
      ? await this.object(name)
      : await this.createObject(name);

    for (const spec of fields) {
      if (handle.hasField(spec.name)) continue;
      await handle.addField(spec.name, spec.type, {
        config: spec.config,
        position: spec.position,
      });
    }
    return handle;
  }

  async deleteObject(nameOrId: string): Promise<void> {
    const handle = await this.object(nameOrId);
    await this.http.request<unknown>("DELETE", `/objects/${handle.id}`);
    this.invalidate();
  }

  invalidate(): void {
    this.permissionsCache = undefined;
    this.objectsCache = undefined;
    this.meCache = undefined;
    this.handleCache.clear();
  }
}

export async function createMiniApp(config: MiniAppConfig): Promise<ErpClient> {
  if (!config.apiKey && !config.accessToken) {
    throw new Error("Either apiKey or accessToken is required");
  }

  const http = new FetchHttp(config);
  const client = new ErpClient(http, config.permissions ?? [], config);
  await client.assertPermissions();
  return client;
}
