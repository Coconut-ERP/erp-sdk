# 15 — Task board AI

[← Wiki & RAG](14-wiki.md) · [Mục lục](README.md)

Mỗi member có **đúng một board kanban trong mỗi workspace**, và chỉ hai bên làm
việc trên đó: chính member ấy và **Arion** (copilot). Member tạo và kéo thẻ;
Arion nộp kết quả phân tích thành một task — báo cáo markdown trong phần mô tả,
tag ghi rõ nó đến từ phân tích nào — rồi trả lại cho member.

Đây không phải công cụ quản lý việc của cả nhóm: không ai khác mở được board,
kể cả owner của workspace, và không có chia sẻ.

```ts
const board = await erp.tasks.board();          // tạo ở lần gọi đầu, kèm taskCounts

const task = await erp.tasks.create({
  title: "Hàng chậm luân chuyển — tháng 8/2026",
  description: baoCaoMarkdown,
  status: "review",
  priority: "high",
  dueDate: new Date("2026-09-20T17:00:00+07:00"),
  tags: ["phan-tich-ton-kho", { name: "kho", color: "#F59E0B" }],
});

await erp.tasks.comment(task.id, "Đã đối chiếu với phiếu xuất kho.");
await erp.tasks.setStatus(task.id, "done");
```

## 1. Ai vào được

| Credential | Kết quả |
| --- | --- |
| Session đăng nhập (`asUser(token)`, `session(initData).client`) | Board của chính người đó |
| Personal key `erp_uk_…` | Board của chủ key — Arion vào bằng đường này: sandbox giữ một key tạo cho member |
| Key service account `erp_sk_…` | **`TaskBoardError`** (`field: "credential"`) ngay tại SDK, không gửi request — server vốn trả 403 vì không có member nào đứng sau key |

Key của mọi mini app là service account. Muốn đọc/ghi board từ mini app, dùng
`(await app.session(initData)).client.tasks` — mọi lời gọi chạy dưới danh tính
người dùng đang mở app.

Không có resource RBAC, không có ACL: là chủ board là đủ. Mọi lời gọi bị giới hạn
trong board của người gọi, nên task trên board người khác trả
**`UnknownTaskError`** (server trả 404 chứ không phải 403 — id không để lộ gì).

## 2. Cột, độ ưu tiên, giao việc

| Trường | Giá trị | Mặc định |
| --- | --- | --- |
| `status` (`TASK_STATUSES`) | `todo`, `in_progress`, `review`, `done`, `archived` | `todo` |
| `priority` (`TASK_PRIORITIES`) | `low`, `medium`, `high`, `urgent` | `medium` |

`board().taskCounts` luôn có **đủ mọi status**, kể cả số 0, để các cột không
xuất hiện rồi biến mất theo dữ liệu.

```ts
await erp.tasks.list({ status: "review", tag: "kho" });        // { tasks, meta }, mới nhất trước
await erp.tasks.listAll({ assignee: { type: "agent", id } });  // đi hết các trang
await erp.tasks.assign(task.id, { type: "user", id: board.ownerId! });
await erp.tasks.assign(task.id, null);                         // bỏ giao
```

Người được giao kiểu `user` **phải là chủ board**. Kiểu `agent` thì id nào cũng
được nhận nguyên như gửi.

## 3. Ký tên agent

`create` và `comment` nhận `actor` tuỳ chọn:

| `actor` | Dòng được ghi tên |
| --- | --- |
| không gửi | người gọi, kiểu `user` |
| `{ type: "agent", id }` | agent đó — **server không xác minh id** |
| `{ type: "user", id }` với id người khác | 403 — member không ký tên member khác |

## 4. Hành vi cần biết

- **`dueDate` là `Date` hoặc timestamp RFC 3339 đầy đủ.** `"2026-09-20"` bị SDK
  chặn bằng `TaskBoardError` thay vì ăn 400 từ server. Đã đặt thì **không xoá
  được**.
- **`metadata` khi update thay cả object** — đọc task, gộp, gửi lại toàn bộ.
- **Tag:** thêm không phân biệt hoa thường (thêm tag đã có thì trả danh sách
  hiện tại), **gỡ phải khớp đúng tên**. Tối đa 50 tag, màu hex.
- **Comment** của user chỉ tác giả xoá được; comment của agent thì member xoá được.
- **Không trùng lặp nào được chặn**: một phân tích chạy lại sẽ tạo thêm thẻ. Đặt
  tag theo lần chạy và `list({ tag })` trước khi tạo.

## 5. Chế độ chạy

Board không có dry run ở server. Ở `ERP_ENV=development`, tạo, sửa, chuyển cột,
giao, comment và gắn tag **vẫn ghi thật**. `delete` và `deleteComment` throw
`DryRunUnsupportedError` vì API không có cách khôi phục; truyền `{ dryRun: false }`
khi đã chắc chắn.

## 6. Giới hạn

| Mục | Trần |
| --- | --- |
| Tên / mô tả board | 255 / 5 000 |
| Tiêu đề task | 500 |
| Mô tả task, nội dung comment | 100 000 |
| Tên tag / số tag mỗi task | 100 / 50 |
| URL đính kèm của comment | 1 024 |

## 7. Bẫy hay gặp

| Triệu chứng | Nguyên nhân |
| --- | --- |
| `TaskBoardError` ở `credential` | Client đang dùng key service account |
| `UnknownTaskError` với id chắc chắn có | Task nằm trên board của người khác |
| 400 khi giao cho đồng nghiệp | Người được giao kiểu `user` phải là chủ board |
| Mất một key trong `metadata` | Update `metadata` thay cả object |
| 404 khi gỡ tag đang thấy | Khác hoa thường — gỡ phải khớp đúng tên |
| Báo cáo xuất hiện hai lần | Không có chống trùng; lọc theo tag trước khi tạo |

[← Wiki & RAG](14-wiki.md) · [Mục lục](README.md)
