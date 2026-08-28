# The Drive — Folders, Files, Sharing, Trash

`erp.files` is the workspace's document store. Use it for what is a *document* — a
signed PDF, an exported spreadsheet, a photo of a delivery note — not for what is a
row. Anything the wiki should be able to answer questions about (`erp.wiki.ask`) also
starts here.

Permissions: `file:create/read/update/delete`, plus the matching `file:public:*` for
anything inside the workspace's shared `Public` tree. A `writer` service account holds
both sets.

## The root holds exactly two folders

```ts
await erp.files.folders();            // no parentId → the drive root
// [{ kind: "personal", name: "…" }, { kind: "public", name: "Public" }]

const mine = await erp.files.personalFolder();
const shared = await erp.files.publicFolder();
const sub = await erp.files.createFolder("Hợp đồng 2026", mine.id);
```

`parentId`/`folderId` is **required everywhere** — nothing new is created at the root,
and the two system folders can't be renamed, moved or deleted. The root coming back
empty means the credentials lack `file:read` (or `file:public:read`), not that the
drive is empty.

## Upload is three steps; `upload()` is all three

```
POST /files/uploads → { file, uploadUrl } → PUT bytes to S3 → POST /files/{id}/complete
```

```ts
const file = await erp.files.upload({
  folderId: mine.id,
  name: "bao-cao-thang-8.csv",
  content: csv,                 // string | Uint8Array | ArrayBuffer | Blob
  mimeType: "text/csv",         // optional — inferred from the extension
});
file.status;                    // "available"
```

- The presigned URL is **signed over the content type**, so the PUT must send exactly
  the type the first step declared. `upload()` handles it; hand-rolling does not get to
  skip it.
- Leaving `mimeType` out infers from the extension (`mimeTypeForName`). An unknown
  extension becomes `application/octet-stream`: it stores, but viewers won't open it
  and **the wiki will not index it**. For a document meant to be asked about, set the
  type.
- If the PUT fails you get `FileUploadError` and the row is stranded in status
  `uploading` — nothing completes it later. Delete it, or re-PUT and call
  `completeUpload(fileId)`.
- Same name in the same folder → `409` from the first step.
- Browser doing its own PUT (progress bar, large file): `startUpload` then
  `completeUpload`.

## Reading

```ts
const { files, meta } = await erp.files.list({ folderId: mine.id, page: 1, perPage: 50 });
const all = await erp.files.listAll({ folderId: mine.id, search: "hợp đồng" });

await erp.files.downloadUrl(id);    // { downloadUrl, expiresInSeconds } — hand to a browser
await erp.files.download(id);       // Uint8Array
await erp.files.downloadText(id);   // string
```

`folderId` is required. With `search` the listing covers the whole subtree by default;
plain browsing stays in the folder — flip either with `recursive`. The download URL
carries **no ERP credential** and expires: pass it on, never store it.

## Sharing

```ts
await erp.files.setFolderSharing(folderId, "restricted", [
  { subjectType: "group", subjectId, access: "write" },
]);
await erp.files.setSharing(fileId, "inherit");
```

| Visibility | Folder | File |
| --- | --- | --- |
| `inherit` | follows its parent | follows its folder; `entries` add access on top |
| `workspace` | everyone in the workspace | — (not accepted on a file) |
| `restricted` | only the `entries` | self-governed, stops following the folder |

`entries` are only accepted alongside `restricted` (and `inherit` on a file). Reading or
setting an ACL takes **manage** on that item. System folders reject ACL changes.

## Trash

Deleting is trashing: 7 days, then the sweep takes the bytes too.

```ts
const { items } = await erp.files.trash();     // one entry per DELETION, not per file
await erp.files.restoreFile(id);               // 409 if the name was taken since
await erp.files.restoreFolder(id);             // brings back the whole subtree

await erp.files.purgeFile(id);                 // no undo
const r = await erp.files.emptyTrash();        // { purged, skipped, freedBytes, hasMore }
```

A deleted folder is **one** trash entry and restores with everything it took down.
`emptyTrash` works in batches — `hasMore: true` means calling again reclaims more, and
`skipped` counts deletions belonging to someone else.

## Dry-run mode

The drive has no server-side dry run, and a document is not a record: in
`ERP_ENV=development` uploads, renames and trashing all **write for real**, the same as
creating a workflow. The exception is the irreversible pair — `purgeFile`,
`purgeFolder`, `emptyTrash` — which throw `DryRunUnsupportedError` instead of shredding
bytes during a rehearsal. Override per call with `{ dryRun: false }`.

## Pitfalls

| Symptom | Cause |
| --- | --- |
| 403 uploading into Public | Missing `file:public:create`, not `file:create` |
| File stuck in `uploading` forever | The PUT step failed; nothing retries it |
| S3 `SignatureDoesNotMatch` | The PUT's `Content-Type` differs from the presign's |
| The wiki won't index an attached file | It uploaded as `application/octet-stream` |
| Restore returns 409 | Something else took that name in the folder meanwhile |
| `folderId is required` | You listed or uploaded without one — the root is not a folder |
