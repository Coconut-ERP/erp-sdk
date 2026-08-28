# 13 — Tệp & thư mục (drive)

[← Workflow](12-workflow.md) · [Mục lục](README.md) · [Tiếp: Wiki & RAG →](14-wiki.md)

Ngoài object engine (bảng/dòng), workspace còn một **drive**: thư mục, tệp,
chia sẻ và thùng rác. Đây là chỗ để hợp đồng PDF, bảng tính xuất ra, ảnh chứng
từ — những thứ là *tài liệu*, không phải record. Wiki lấy tài liệu từ đây để
index và trả lời câu hỏi ([14](14-wiki.md)).

```ts
const erp = await createMiniApp({
  baseUrl: process.env.ERP_BASE_URL,
  apiKey: process.env.ERP_API_KEY,
  permissions: [{ resource: "file", action: "read" }],
});

const folder = await erp.files.personalFolder();
const file = await erp.files.upload({
  folderId: folder.id,
  name: "bao-cao-thang-8.csv",
  content: csv,
});
```

## 1. Gốc drive chỉ có hai thư mục

Liệt kê thư mục mà không truyền `parentId` sẽ ra đúng **hai** thư mục hệ thống,
server tự tạo lần đầu ai đó chạm vào:

| Thư mục | `kind` | Là gì |
| --- | --- | --- |
| Của tôi | `personal` | Thư mục riêng của chính người đang gọi |
| Public | `public` | Cây dùng chung của workspace — cần thêm quyền `file:public` |

```ts
await erp.files.folders();              // gốc: đúng hai thư mục trên
await erp.files.folders(folder.id);     // thư mục con của một thư mục
await erp.files.personalFolder();
await erp.files.publicFolder();

const sub = await erp.files.createFolder("Hợp đồng 2026", folder.id);
await erp.files.updateFolder(sub.id, { name: "Hợp đồng", parentId: other.id });
await erp.files.deleteFolder(sub.id);   // vào thùng rác cùng toàn bộ cây con
```

**Không tạo được gì ở gốc**: mọi thư mục/tệp mới đều nằm trong cây `personal`
hoặc cây `Public`, nên `parentId`/`folderId` là bắt buộc. Thư mục hệ thống
không đổi tên, không di chuyển, không xoá được.

## 2. Upload là ba bước, `upload()` làm cả ba

Bytes không đi qua ERP: server tạo row, ký một URL S3 tạm, client PUT thẳng lên
storage, rồi báo hoàn tất.

```
POST /files/uploads ──► { file, uploadUrl }
        │
        └─► PUT uploadUrl (bytes, đúng Content-Type) ──► POST /files/{id}/complete
```

```ts
const file = await erp.files.upload({
  folderId: folder.id,
  name: "hop-dong.pdf",
  content: bytes,          // string | Uint8Array | ArrayBuffer | Blob
  mimeType: "application/pdf",   // bỏ trống thì suy từ đuôi tên
});
file.status;               // "available"
```

- **`Content-Type` phải khớp** cái đã gửi ở bước 1 — URL ký kèm content type,
  lệch là storage từ chối. `upload()` tự lo; tự làm tay thì phải gửi đúng.
- Bỏ trống `mimeType` thì SDK suy từ đuôi tên (`mimeTypeForName`): pdf, docx,
  xlsx, csv, ảnh… Đuôi lạ ra `application/octet-stream` — lưu vẫn được nhưng
  trình xem không mở được và **wiki sẽ không index**.
- Bước giữa hỏng → `FileUploadError`, và row nằm lại ở trạng thái `uploading`:
  không ai tự hoàn tất nó, hoặc xoá đi hoặc PUT lại rồi
  `files.completeUpload(fileId)`.
- Trùng tên trong cùng thư mục là `409` ngay ở bước 1.

Cần tự điều khiển (browser tự PUT, upload lớn cần progress) thì dùng
`startUpload` / `completeUpload` riêng.

## 3. Liệt kê, tải về, đổi tên

```ts
const { files, meta } = await erp.files.list({ folderId: folder.id, page: 1 });
const all = await erp.files.listAll({ folderId: folder.id, search: "hợp đồng" });

await erp.files.get(file.id);
await erp.files.downloadUrl(file.id);    // { downloadUrl, expiresInSeconds } — đưa cho browser
await erp.files.download(file.id);       // Uint8Array
await erp.files.downloadText(file.id);   // string (UTF-8)

await erp.files.update(file.id, { name: "hop-dong-2026.pdf", folderId: other.id });
await erp.files.delete(file.id);         // vào thùng rác
```

`folderId` là bắt buộc khi liệt kê. Có `search` thì mặc định quét cả cây con,
duyệt thường thì chỉ trong đúng thư mục — đổi bằng `recursive`.

URL tải về **không mang credential ERP** và sẽ hết hạn: đưa thẳng cho browser,
đừng lưu vào database.

## 4. Chia sẻ

```ts
await erp.files.folderSharing(folder.id);
await erp.files.setFolderSharing(folder.id, "restricted", [
  { subjectType: "group", subjectId: groupId, access: "write" },
]);

await erp.files.setSharing(file.id, "inherit");   // tệp theo thư mục
```

| Visibility | Thư mục | Tệp |
| --- | --- | --- |
| `inherit` | theo thư mục cha | theo thư mục chứa nó, `entries` cộng thêm quyền |
| `workspace` | cả workspace đọc được | — |
| `restricted` | chỉ những ai có trong `entries` | tệp tự quản, không theo thư mục nữa |

`entries` chỉ được nhận cùng `restricted` (với tệp thì cả `inherit`). Đọc/ghi
ACL cần quyền **manage** trên chính đối tượng đó. Thư mục hệ thống giữ nguyên
visibility, không sửa được.

## 5. Thùng rác

Xoá là **chuyển vào thùng rác**, giữ 7 ngày rồi mới quét sạch cùng bytes trong
storage.

```ts
const { items } = await erp.files.trash();
await erp.files.restoreFile(id);      // 409 nếu tên đã bị chiếm lại
await erp.files.restoreFolder(id);    // khôi phục cả cây bị xoá cùng lần đó

await erp.files.purgeFile(id);        // xoá hẳn ngay, không hoàn tác
const r = await erp.files.emptyTrash();  // { purged, skipped, freedBytes, hasMore }
```

Mỗi dòng trong thùng rác là **một lần xoá**, không phải một file: xoá thư mục
thì nó xuất hiện một lần, khôi phục/xoá hẳn kéo theo cả cây. `emptyTrash` chạy
theo lô — `hasMore: true` nghĩa là gọi tiếp còn dọn được nữa; `skipped` là
những lần xoá của người khác mà mình không có quyền.

## 6. Quyền và chế độ chạy

- Cần `file:create/read/update/delete`; đụng vào cây **Public** cần thêm
  `file:public` tương ứng. Role `writer` (mặc định của service account mini
  app) có đủ cả hai bộ.
- Drive **không có dry run** trên server, và tài liệu không phải record: ở
  `ERP_ENV=development` mọi thao tác vẫn ghi thật, giống như tạo workflow.
  Ngoại lệ là hai lệnh không hoàn tác được — `purgeFile`/`purgeFolder` và
  `emptyTrash` — chúng throw `DryRunUnsupportedError` thay vì phá bytes trong
  lúc diễn tập. Muốn chạy thật thì `{ dryRun: false }`.

## 7. Bẫy hay gặp

| Triệu chứng | Nguyên nhân |
| --- | --- |
| `403` khi upload vào Public | Thiếu `file:public:create`, chứ không phải `file:create` |
| File ở trạng thái `uploading` mãi | Bước PUT hỏng — không có gì tự hoàn tất nó |
| Storage trả `SignatureDoesNotMatch` | `Content-Type` lúc PUT khác lúc xin URL |
| Wiki không index tài liệu vừa gắn | MIME là `application/octet-stream` vì đuôi tên lạ |
| Khôi phục báo `409` | Có thứ khác đã chiếm tên đó trong thư mục |

---

[← Workflow](12-workflow.md) · [Mục lục](README.md) · [Tiếp: Wiki & RAG →](14-wiki.md)
