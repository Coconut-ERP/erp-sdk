# The drive

`erp.files` is the workspace's document store — a signed PDF, an exported spreadsheet,
a delivery photo — not a place for rows. A document the wiki should answer questions
about (`erp.wiki.ask`) starts here too.

Permissions: `file:create` / `read` / `update` / `delete`, plus the matching
`file:public:*` inside `Public`. A `writer` service account has both sets.

## Contents

- [Folders](#folders)
- [Uploading](#uploading)
- [Listing and downloading](#listing-and-downloading)
- [Sharing](#sharing)
- [Trash](#trash)
- [Pitfalls](#pitfalls)

## Folders

```ts
await erp.files.folders();                      // the root: [{ kind: "personal" }, { kind: "public", name: "Public" }]
const mine = await erp.files.personalFolder();
const shared = await erp.files.publicFolder();
const sub = await erp.files.createFolder("Hợp đồng 2026", mine.id);
```

Nothing is created at the root, so `parentId` / `folderId` is required everywhere. The
two system folders cannot be renamed, moved, deleted or re-shared. An empty root means
no `file:read` (or `file:public:read`), not an empty drive.

## Uploading

```ts
const file = await erp.files.upload({
  folderId: mine.id,
  name: "bao-cao-thang-8.csv",
  content: csv,                 // string | Uint8Array | ArrayBuffer | Blob
  mimeType: "text/csv",         // optional; inferred from the extension
});
file.status;                    // "available"
```

`upload()` runs `POST /files/uploads` → PUT to the presigned URL → `POST
/files/{id}/complete`.

- The presigned URL is signed over the content type; a PUT with another type fails
  with S3 `SignatureDoesNotMatch`.
- Without `mimeType` the type comes from `mimeTypeForName`. An unknown extension is
  `application/octet-stream`: stored, but viewers won't open it and **the wiki will not
  index it**. Set the type for anything meant to be asked about.
- A failed PUT throws `FileUploadError` and strands the row in `uploading`. Delete it,
  or PUT again and call `completeUpload(fileId)`.
- The same name in the same folder is a 409.
- A browser doing its own PUT (progress, large files) uses `startUpload` then
  `completeUpload`.

## Listing and downloading

```ts
const { files, meta } = await erp.files.list({ folderId: mine.id, page: 1, perPage: 50 });
const all = await erp.files.listAll({ folderId: mine.id, search: "hợp đồng" });

await erp.files.download(id);       // Uint8Array
await erp.files.downloadText(id);   // string
await erp.files.downloadUrl(id);    // { downloadUrl, expiresInSeconds } — for a browser
```

With `search`, a listing covers the whole subtree; without it, only the folder —
`recursive` flips either. A download URL carries no ERP credential and expires: pass it
on, never store it.

## Sharing

```ts
await erp.files.setFolderSharing(folderId, "restricted", [{ subjectType: "group", subjectId, access: "write" }]);
await erp.files.setSharing(fileId, "inherit");
```

| Visibility | Folder | File |
| --- | --- | --- |
| `inherit` | Follows its parent | Follows its folder; `entries` add access on top |
| `workspace` | Everyone in the workspace | Not accepted |
| `restricted` | Only the `entries` | Only the `entries`; stops following the folder |

`entries` are accepted only with `restricted`, or `inherit` on a file. Reading or
setting an ACL needs manage on the item.

## Trash

Deleting trashes for 7 days; then a sweep removes the bytes.

```ts
const { items } = await erp.files.trash();     // one entry per deletion — a folder is one entry
await erp.files.restoreFile(id);               // 409 if the name was taken meanwhile
await erp.files.restoreFolder(id);             // the whole subtree
await erp.files.purgeFile(id);                 // irreversible
const r = await erp.files.emptyTrash();        // { purged, skipped, freedBytes, hasMore }
```

`emptyTrash` works in batches: `hasMore: true` means call again; `skipped` counts
other people's deletions. In development mode uploads, renames and trashing write for
real, while `purgeFile`, `purgeFolder` and `emptyTrash` refuse.

## Pitfalls

| Symptom | Cause |
| --- | --- |
| 403 uploading into Public | Needs `file:public:create` |
| File stuck in `uploading` | The PUT failed; nothing completes it later |
| S3 `SignatureDoesNotMatch` | PUT `Content-Type` differs from the presigned one |
| Wiki won't index an attachment | Uploaded as `application/octet-stream` |
| `folderId is required` | The root is not a folder |
