import {
  MissingPermissionsError,
  UnknownFieldError,
  UnknownObjectError,
} from "./errors";
import { FetchHttp, type Http } from "./http";
import { ObjectHandle } from "./objects";
import { isAllowed, missingPermissions } from "./permissions";
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
  fetch?: typeof globalThis.fetch;
}

export class ErpClient {
  private permissionsCache?: PermissionDto[];
  private objectsCache?: ObjectDto[];
  private meCache?: UserDto;
  private readonly handleCache = new Map<string, ObjectHandle>();

  constructor(
    readonly http: Http,
    private readonly required: RequiredPermission[] = [],
    private readonly config?: MiniAppConfig,
  ) {}

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
    return new ErpClient(http, [], {
      ...this.config,
      apiKey: undefined,
      accessToken,
      workspaceId: workspaceId ?? this.config.workspaceId,
    });
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
    const missing = missingPermissions(await this.myPermissions(true), required);
    if (missing.length > 0) throw new MissingPermissionsError(missing);
  }

  async objects(refresh = false): Promise<ObjectDto[]> {
    if (!this.objectsCache || refresh) {
      this.objectsCache = await this.http.request<ObjectDto[]>("GET", "/objects");
    }
    return this.objectsCache;
  }

  async object(nameOrId: string): Promise<ObjectHandle> {
    const cached = this.handleCache.get(nameOrId);
    if (cached) return cached;

    const objects = await this.objects();
    const meta =
      objects.find((o) => o.id === nameOrId) ??
      objects.find((o) => o.name === nameOrId) ??
      objects.find((o) => o.name.toLowerCase() === nameOrId.toLowerCase());
    if (!meta) throw new UnknownObjectError(nameOrId);

    const fields = await this.http.request<FieldDto[]>(
      "GET",
      `/objects/${meta.id}/fields`,
    );
    const handle = new ObjectHandle(this.http, meta, fields ?? []);
    this.handleCache.set(nameOrId, handle);
    this.handleCache.set(meta.id, handle);
    return handle;
  }

  async createObject(
    name: string,
    options: { position?: number } = {},
  ): Promise<ObjectHandle> {
    const meta = await this.http.request<ObjectDto>("POST", "/objects", {
      body: { name, position: options.position ?? 0 },
    });
    this.objectsCache = undefined;
    const handle = new ObjectHandle(this.http, meta, []);
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
    const objects = await this.objects();
    return objects.some(
      (o) =>
        o.id === nameOrId ||
        o.name.toLowerCase() === nameOrId.toLowerCase(),
    );
  }

  /**
   * Idempotent provisioning: returns the object if it exists (creating it
   * otherwise) and adds any of the given fields that are missing.
   */
  async ensureObject(
    name: string,
    fields: EnsureFieldSpec[] = [],
  ): Promise<ObjectHandle> {
    let handle: ObjectHandle;
    try {
      handle = await this.object(name);
    } catch (error) {
      if (!(error instanceof UnknownObjectError)) throw error;
      await this.objects(true);
      handle = (await this.hasObject(name))
        ? await this.object(name)
        : await this.createObject(name);
    }

    for (const spec of fields) {
      try {
        handle.field(spec.name);
      } catch (error) {
        if (!(error instanceof UnknownFieldError)) throw error;
        await handle.addField(spec.name, spec.type, {
          config: spec.config,
          position: spec.position,
        });
      }
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
