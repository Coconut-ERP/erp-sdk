import { DryRunUnsupportedError, FileUploadError } from "./errors";
import type { Http } from "./http";
import type { WriteOptions } from "./objects";
import type {
  EmptyTrashResult,
  FileDownloadDto,
  FileDto,
  FileSharingDto,
  FileUploadDto,
  FileVisibility,
  FolderDto,
  PageMeta,
  SharingEntry,
  TrashItemDto,
} from "./types";

/** What the server stores when an upload names no type of its own. */
export const DEFAULT_MIME_TYPE = "application/octet-stream";

/** How long a deletion stays restorable before the sweep purges it. */
export const TRASH_RETENTION_DAYS = 7;

/**
 * Enough of a type table to name the documents a workspace actually keeps —
 * anything else uploads as {@link DEFAULT_MIME_TYPE}, which stores fine but
 * opens as a download instead of in the viewer, and which the wiki will not
 * index. Pass `mimeType` explicitly for anything not listed.
 */
const MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  xml: "application/xml",
  html: "text/html",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  zip: "application/zip",
};

/** The MIME type a name implies, or {@link DEFAULT_MIME_TYPE}. */
export function mimeTypeForName(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return DEFAULT_MIME_TYPE;
  return MIME_TYPES[name.slice(dot + 1).toLowerCase()] ?? DEFAULT_MIME_TYPE;
}

/** What {@link FilesApi.upload} accepts as the bytes of a file. */
export type FileContent = string | Uint8Array | ArrayBuffer | Blob;

export interface UploadSpec {
  /**
   * Which folder it lands in. Required — the drive root holds only the two
   * system folders, so every upload names a folder inside one of their trees.
   * {@link FilesApi.personalFolder} and {@link FilesApi.publicFolder} are the
   * usual answers.
   */
  folderId: string;
  name: string;
  content: FileContent;
  /** Defaults to what the name implies — see {@link mimeTypeForName}. */
  mimeType?: string;
}

export interface ListFilesOptions {
  /** Required: files always live inside a folder tree. */
  folderId: string;
  /** Filter by name (contains). Searching covers the subtree by default. */
  search?: string;
  /** Browse the subtree too. Defaults to `true` while `search` is set. */
  recursive?: boolean;
  page?: number;
  perPage?: number;
}

export interface FolderChanges {
  name?: string;
  /** Moves it under a different parent. System folders refuse both. */
  parentId?: string;
}

export interface FileChanges {
  name?: string;
  /** Moves it to another folder. */
  folderId?: string;
}

export interface FilesApiOptions extends WriteOptions {
  /**
   * Used for the presigned PUT to storage, which does not go through
   * {@link Http}: it carries no ERP credentials and must not be sent any.
   */
  fetch?: typeof globalThis.fetch;
}

async function toBytes(content: FileContent): Promise<Uint8Array> {
  if (typeof content === "string") return new TextEncoder().encode(content);
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  return new Uint8Array(await content.arrayBuffer());
}

/**
 * `client.files` — the workspace's drive: folders, the files in them, sharing,
 * and the trash.
 *
 * Two things shape every call. **The root is not a folder anyone writes into**:
 * listing folders without a parent returns exactly two, the caller's personal
 * folder and the workspace's shared `Public` folder, and everything created
 * lives inside one of those trees. And **a file is three steps, not one** —
 * the row is created, the bytes are PUT to a presigned storage URL, then the
 * upload is completed — which {@link upload} does in one call.
 *
 * The drive has no dry run on the server, and a document is not a record: an
 * upload in `development` mode writes for real, the same way creating a
 * workflow does. The two irreversible calls are the exception — purging a
 * deletion and emptying the trash throw {@link DryRunUnsupportedError} rather
 * than destroy bytes during a rehearsal.
 */
export class FilesApi {
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(
    private readonly http: Http,
    private readonly options: FilesApiOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private refuseDryRun(operation: string, options: WriteOptions): void {
    if (options.dryRun ?? this.options.dryRun ?? false) {
      throw new DryRunUnsupportedError(operation);
    }
  }

  // ---------------------------------------------------------------- folders

  /**
   * The folders directly under `parentId`. Without one, the drive root: the
   * caller's personal folder and the workspace's `Public` folder, both
   * provisioned on first access.
   */
  async folders(parentId?: string): Promise<FolderDto[]> {
    return (
      (await this.http.request<FolderDto[]>("GET", "/files/folders", {
        query: { parentId },
      })) ?? []
    );
  }

  /** The caller's own folder — where an upload goes when it is nobody else's. */
  async personalFolder(): Promise<FolderDto> {
    return this.systemFolder("personal");
  }

  /** The workspace's shared tree. Reaching it also takes `file:public`. */
  async publicFolder(): Promise<FolderDto> {
    return this.systemFolder("public");
  }

  private async systemFolder(kind: "personal" | "public"): Promise<FolderDto> {
    const roots = await this.folders();
    const found = roots.find((folder) => folder.kind === kind);
    if (!found) {
      throw new Error(
        `No ${kind} folder in this workspace's drive root — the credentials ` +
          `may lack file:read${kind === "public" ? " or file:public:read" : ""}`,
      );
    }
    return found;
  }

  async folder(folderId: string): Promise<FolderDto> {
    return this.http.request<FolderDto>("GET", `/files/folders/${folderId}`);
  }

  /** `parentId` is required — nothing new is created at the drive root. */
  async createFolder(name: string, parentId: string): Promise<FolderDto> {
    return this.http.request<FolderDto>("POST", "/files/folders", {
      body: { name, parentId },
    });
  }

  /** Renames or moves it. System folders refuse both. */
  async updateFolder(
    folderId: string,
    changes: FolderChanges,
  ): Promise<FolderDto> {
    return this.http.request<FolderDto>("PUT", `/files/folders/${folderId}`, {
      body: changes,
    });
  }

  /**
   * Moves the folder **and everything below it** to the trash as one deletion,
   * restorable for {@link TRASH_RETENTION_DAYS} days.
   */
  async deleteFolder(folderId: string): Promise<void> {
    await this.http.request<unknown>("DELETE", `/files/folders/${folderId}`);
  }

  /** The folder's visibility and, when `restricted`, its grants. Takes manage. */
  async folderSharing(folderId: string): Promise<FileSharingDto> {
    return this.http.request<FileSharingDto>(
      "GET",
      `/files/folders/${folderId}/acl`,
    );
  }

  /**
   * Sets visibility and replaces the grants. `inherit` follows the parent,
   * `workspace` opens it to everyone, `restricted` limits it to `entries` —
   * which are only accepted with `restricted`.
   */
  async setFolderSharing(
    folderId: string,
    visibility: FileVisibility,
    entries: SharingEntry[] = [],
  ): Promise<FileSharingDto> {
    return this.http.request<FileSharingDto>(
      "PUT",
      `/files/folders/${folderId}/acl`,
      { body: { visibility, entries } },
    );
  }

  // ------------------------------------------------------------------ files

  /** One page of a folder's files, with the envelope's page counts. */
  async list(
    options: ListFilesOptions,
  ): Promise<{ files: FileDto[]; meta?: PageMeta }> {
    const paged = await this.http.requestPaged<FileDto[]>("GET", "/files", {
      query: {
        folderId: options.folderId,
        search: options.search,
        recursive: options.recursive,
        page: options.page,
        perPage: options.perPage,
      },
    });
    return { files: paged.data ?? [], meta: paged.meta };
  }

  /** Every file the listing matches, walking `meta.totalPages`. */
  async listAll(
    options: Omit<ListFilesOptions, "page" | "perPage"> & { perPage?: number },
  ): Promise<FileDto[]> {
    const perPage = options.perPage ?? 100;
    const first = await this.list({ ...options, page: 1, perPage });
    const all = [...first.files];
    const pages = first.meta?.totalPages ?? 1;
    for (let page = 2; page <= pages; page++) {
      all.push(...(await this.list({ ...options, page, perPage })).files);
    }
    return all;
  }

  async get(fileId: string): Promise<FileDto> {
    return this.http.request<FileDto>("GET", `/files/${fileId}`);
  }

  /**
   * Uploads a file whole: creates the row, PUTs the bytes to the presigned
   * storage URL, and completes the upload. The returned file is `available`
   * with the size storage actually recorded.
   *
   * ```ts
   * const folder = await erp.files.personalFolder();
   * const file = await erp.files.upload({
   *   folderId: folder.id,
   *   name: "bao-cao-thang-8.csv",
   *   content: csv,
   * });
   * ```
   *
   * If the middle step fails the row is left behind in status `uploading` and
   * {@link FileUploadError} says so — nothing completes it later on its own.
   * A name already taken in that folder is a 409 from the first step.
   */
  async upload(spec: UploadSpec): Promise<FileDto> {
    const bytes = await toBytes(spec.content);
    const mimeType = spec.mimeType ?? mimeTypeForName(spec.name);
    const started = await this.startUpload({
      folderId: spec.folderId,
      name: spec.name,
      mimeType,
      sizeBytes: bytes.byteLength,
    });

    // The presigned URL is signed over the content type, so storage rejects
    // the PUT unless this header matches what was sent to /files/uploads.
    const response = await this.fetchImpl(started.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": mimeType },
      body: bytes as unknown as BodyInit,
    });
    if (!response.ok) {
      throw new FileUploadError(
        spec.name,
        response.status,
        (await response.text().catch(() => "")) || response.statusText,
      );
    }

    return this.completeUpload(started.file.id);
  }

  /**
   * The first of the three upload steps on its own — for a browser that will
   * PUT the bytes itself, or an upload big enough to want its own progress.
   * The file exists but is not readable until {@link completeUpload}.
   */
  async startUpload(spec: {
    folderId: string;
    name: string;
    mimeType?: string;
    sizeBytes?: number;
  }): Promise<FileUploadDto> {
    return this.http.request<FileUploadDto>("POST", "/files/uploads", {
      body: {
        folderId: spec.folderId,
        name: spec.name,
        mimeType: spec.mimeType ?? mimeTypeForName(spec.name),
        sizeBytes: spec.sizeBytes ?? 0,
      },
    });
  }

  /** Verifies the bytes landed and makes the file available. Idempotent. */
  async completeUpload(fileId: string): Promise<FileDto> {
    return this.http.request<FileDto>("POST", `/files/${fileId}/complete`);
  }

  /**
   * A presigned URL that downloads the file as an attachment. It carries no
   * ERP credentials and expires — hand it to a browser, do not store it.
   */
  async downloadUrl(fileId: string): Promise<FileDownloadDto> {
    return this.http.request<FileDownloadDto>(
      "GET",
      `/files/${fileId}/download`,
    );
  }

  /** The bytes themselves, by following {@link downloadUrl}. */
  async download(fileId: string): Promise<Uint8Array> {
    const { downloadUrl } = await this.downloadUrl(fileId);
    const response = await this.fetchImpl(downloadUrl);
    if (!response.ok) {
      throw new Error(
        `Downloading file ${fileId} failed with HTTP ${response.status} ` +
          `${response.statusText}`,
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  /** {@link download} decoded as UTF-8 — for the text files an app writes. */
  async downloadText(fileId: string): Promise<string> {
    return new TextDecoder().decode(await this.download(fileId));
  }

  /** Renames the file or moves it to another folder. */
  async update(fileId: string, changes: FileChanges): Promise<FileDto> {
    return this.http.request<FileDto>("PUT", `/files/${fileId}`, {
      body: changes,
    });
  }

  /** To the trash, restorable for {@link TRASH_RETENTION_DAYS} days. */
  async delete(fileId: string): Promise<void> {
    await this.http.request<unknown>("DELETE", `/files/${fileId}`);
  }

  async sharing(fileId: string): Promise<FileSharingDto> {
    return this.http.request<FileSharingDto>("GET", `/files/${fileId}/acl`);
  }

  /**
   * A file takes `inherit` — keep following the folder, with `entries` adding
   * access on top — or `restricted`, which makes it self-governed.
   */
  async setSharing(
    fileId: string,
    visibility: Exclude<FileVisibility, "workspace">,
    entries: SharingEntry[] = [],
  ): Promise<FileSharingDto> {
    return this.http.request<FileSharingDto>("PUT", `/files/${fileId}/acl`, {
      body: { visibility, entries },
    });
  }

  // ------------------------------------------------------------------ trash

  /**
   * One page of the trash, newest first — one entry per **deletion**, so a
   * deleted folder appears once rather than once per file it took with it.
   */
  async trash(
    options: { page?: number; perPage?: number } = {},
  ): Promise<{ items: TrashItemDto[]; meta?: PageMeta }> {
    const paged = await this.http.requestPaged<TrashItemDto[]>(
      "GET",
      "/files/trash",
      { query: { page: options.page, perPage: options.perPage } },
    );
    return { items: paged.data ?? [], meta: paged.meta };
  }

  /** Puts a deleted file back where it was. 409 if the name was taken since. */
  async restoreFile(fileId: string): Promise<FileDto> {
    return this.http.request<FileDto>(
      "POST",
      `/files/trash/files/${fileId}/restore`,
    );
  }

  /** Restores the folder together with everything its deletion took down. */
  async restoreFolder(folderId: string): Promise<FolderDto> {
    return this.http.request<FolderDto>(
      "POST",
      `/files/trash/folders/${folderId}/restore`,
    );
  }

  /**
   * Removes the file and its bytes now instead of waiting out the retention.
   * There is no undo, so it refuses in development mode.
   */
  async purgeFile(fileId: string, options: WriteOptions = {}): Promise<void> {
    this.refuseDryRun(`purging file ${fileId}`, options);
    await this.http.request<unknown>("DELETE", `/files/trash/files/${fileId}`);
  }

  /** {@link purgeFile} for a folder — and everything its deletion took down. */
  async purgeFolder(
    folderId: string,
    options: WriteOptions = {},
  ): Promise<void> {
    this.refuseDryRun(`purging folder ${folderId}`, options);
    await this.http.request<unknown>(
      "DELETE",
      `/files/trash/folders/${folderId}`,
    );
  }

  /**
   * Purges every deletion this caller could have purged one at a time.
   * Bounded per call: `hasMore` means the batch filled up and calling again
   * reclaims more. `skipped` counts what belongs to someone else. No undo, so
   * it refuses in development mode.
   */
  async emptyTrash(options: WriteOptions = {}): Promise<EmptyTrashResult> {
    this.refuseDryRun("emptying the trash", options);
    return this.http.request<EmptyTrashResult>("DELETE", "/files/trash");
  }
}
