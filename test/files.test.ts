import { describe, expect, it } from "vitest";
import { DryRunUnsupportedError, FileUploadError } from "../src/errors";
import { FilesApi, mimeTypeForName } from "../src/files";
import type { FileDto, FolderDto } from "../src/types";
import { FakeHttp } from "./helpers/http";

function folder(overrides: Partial<FolderDto> = {}): FolderDto {
  return {
    id: "fol-1",
    workspaceId: "ws-1",
    name: "Tài liệu",
    visibility: "inherit",
    kind: "normal",
    createdBy: "u",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

function file(overrides: Partial<FileDto> = {}): FileDto {
  return {
    id: "file-1",
    workspaceId: "ws-1",
    folderId: "fol-1",
    name: "bao-cao.csv",
    visibility: "inherit",
    mimeType: "text/csv",
    sizeBytes: 12,
    version: 1,
    status: "available",
    createdBy: "u",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("mimeTypeForName", () => {
  it("names the documents a workspace keeps and falls back otherwise", () => {
    expect(mimeTypeForName("bao-cao.csv")).toBe("text/csv");
    expect(mimeTypeForName("HỢP ĐỒNG.PDF")).toBe("application/pdf");
    expect(mimeTypeForName("noname")).toBe("application/octet-stream");
    expect(mimeTypeForName("archive.rar")).toBe("application/octet-stream");
  });
});

describe("folders", () => {
  it("finds the two system folders at the drive root", async () => {
    const http = new FakeHttp({
      "GET /files/folders": [
        [
          folder({ id: "fol-me", kind: "personal", name: "Của tôi" }),
          folder({ id: "fol-pub", kind: "public", name: "Public" }),
        ],
      ],
    });
    const files = new FilesApi(http);

    expect((await files.personalFolder()).id).toBe("fol-me");
    expect((await files.publicFolder()).id).toBe("fol-pub");
    expect(http.calls[0]?.options.query).toEqual({ parentId: undefined });
  });

  it("says which permission is missing when the root comes back empty", async () => {
    const files = new FilesApi(new FakeHttp({ "GET /files/folders": [[]] }));
    await expect(files.publicFolder()).rejects.toThrow(/file:public:read/);
  });
});

describe("upload", () => {
  it("starts, PUTs the bytes with the presigned content type, completes", async () => {
    const http = new FakeHttp({
      "POST /files/uploads": [
        {
          file: file({ status: "uploading" }),
          uploadUrl: "https://s3/put",
          expiresInSeconds: 900,
        },
      ],
      "POST /files/file-1/complete": [file()],
    });
    const requests: { url: string; init?: RequestInit }[] = [];
    const files = new FilesApi(http, {
      fetch: (async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        return new Response("", { status: 200 });
      }) as unknown as typeof globalThis.fetch,
    });

    const uploaded = await files.upload({
      folderId: "fol-1",
      name: "bao-cao.csv",
      content: "a,b\n1,2\n",
    });

    expect(uploaded.status).toBe("available");
    expect(http.body(0)).toEqual({
      folderId: "fol-1",
      name: "bao-cao.csv",
      mimeType: "text/csv",
      sizeBytes: 8,
    });
    const put = requests[0];
    expect(put?.url).toBe("https://s3/put");
    expect(put?.init?.method).toBe("PUT");
    const headers = (put?.init?.headers ?? {}) as Record<string, string>;
    expect(headers["Content-Type"]).toBe("text/csv");
  });

  it("names the stuck row when storage refuses the bytes", async () => {
    const http = new FakeHttp({
      "POST /files/uploads": [
        { file: file(), uploadUrl: "https://s3/put", expiresInSeconds: 900 },
      ],
    });
    const files = new FilesApi(http, {
      fetch: (async () =>
        new Response("SignatureDoesNotMatch", {
          status: 403,
        })) as unknown as typeof globalThis.fetch,
    });

    await expect(
      files.upload({ folderId: "fol-1", name: "bao-cao.csv", content: "x" }),
    ).rejects.toBeInstanceOf(FileUploadError);
  });
});

describe("listing and download", () => {
  it("walks every page of a folder", async () => {
    const http = new FakeHttp(
      { "GET /files": [[file({ id: "f1" })], [file({ id: "f2" })]] },
      { page: 1, perPage: 1, totalItems: 2, totalPages: 2 },
    );
    const files = new FilesApi(http);

    const all = await files.listAll({ folderId: "fol-1", perPage: 1 });
    expect(all.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(http.calls[1]?.options.query).toMatchObject({ page: 2 });
  });

  it("follows the presigned URL and decodes text", async () => {
    const http = new FakeHttp({
      "GET /files/file-1/download": [
        { downloadUrl: "https://s3/get", expiresInSeconds: 300 },
      ],
    });
    const files = new FilesApi(http, {
      fetch: (async () =>
        new Response("xin chào")) as unknown as typeof globalThis.fetch,
    });

    expect(await files.downloadText("file-1")).toBe("xin chào");
  });
});

describe("trash", () => {
  it("restores without complaint", async () => {
    const http = new FakeHttp({
      "POST /files/trash/files/file-1/restore": [file()],
    });
    expect((await new FilesApi(http).restoreFile("file-1")).id).toBe("file-1");
  });

  it("refuses to purge during a rehearsal, but trashing is fine", async () => {
    const http = new FakeHttp({ "DELETE /files/file-1": [null] });
    const files = new FilesApi(http, { dryRun: true });

    await files.delete("file-1");
    await expect(files.purgeFile("file-1")).rejects.toBeInstanceOf(
      DryRunUnsupportedError,
    );
    await expect(files.emptyTrash()).rejects.toBeInstanceOf(
      DryRunUnsupportedError,
    );
  });
});
