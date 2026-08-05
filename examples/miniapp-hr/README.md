# HR — Cổng thông tin nhân sự (mini app)

Mini app chạy trên nền ERP, dành cho **toàn bộ nhân viên**: mỗi người tự xem và
cập nhật hồ sơ của chính mình, tra cứu danh bạ, cơ cấu tổ chức, tài sản đang giữ
và các quy định của công ty. App **không có màn hình nghiệp vụ riêng cho HR** —
không duyệt, không phê chuẩn, không quản trị người khác.

Stack: Next.js 16 (App Router) · TypeScript · Tailwind v4 · shadcn/ui (light mode
only) · TanStack Query · react-hook-form + zod · Biome · Bun · `erp-sdk`.

## Màn hình

| Nhóm | Màn hình | Quyền của người dùng |
| --- | --- | --- |
| Hồ sơ cá nhân | Tổng quan | đọc — tóm tắt, việc cần làm, văn bản mới |
| | Hồ sơ của tôi | đọc + sửa hồ sơ của chính mình |
| | Liên hệ khẩn cấp | thêm / sửa / xoá |
| | Người phụ thuộc | thêm / sửa / xoá |
| | Trình độ & bằng cấp | thêm / sửa / xoá |
| | Quá trình công tác | thêm / sửa / xoá |
| | Tài sản của tôi | chỉ đọc (do bộ phận quản lý tài sản cấp phát) |
| Thông tin công ty | Danh bạ nhân sự | chỉ đọc, chỉ các cột phục vụ công việc |
| | Cơ cấu tổ chức | chỉ đọc — phòng ban, chức danh |
| | Quy định & chính sách | chỉ đọc |

## Mô hình dữ liệu

App khai báo 10 bảng trong `schema.json`; người deploy duyệt và áp dụng, app chỉ
kiểm tra lại lúc boot:

```
Phòng ban ─┬─◄ Nhân sự ─┬─◄ Liên hệ khẩn cấp
Chức danh ─┘     │      ├─◄ Người phụ thuộc
                 │      ├─◄ Trình độ & bằng cấp
                 │      ├─◄ Quá trình công tác ──► Phòng ban, Chức danh
                 │      └─◄ Cấp phát tài sản ────► Danh mục tài sản
                 └──► Quản lý trực tiếp (tự tham chiếu)

Quy định & chính sách ──► Phòng ban áp dụng
```

Ba quy ước quan trọng:

- **Mọi tham chiếu giữa các bảng là field `relation` thật**, không phải text.
  Giá trị relation nằm ở **links API**, không nằm trong `record.data` — app ghi
  bằng `createLink`/`deleteLink` (xem `src/lib/erp/records.ts`).
- **Cột `lookup`** (`Tên phòng ban`, `Tên chức danh`, `Tên tài sản`…) giúp danh
  sách hiển thị tên bản ghi liên kết mà không phải gọi links cho từng dòng.
  Backend tính bất đồng bộ, thường xong sau vài giây. Lookup **không khai báo
  được trong `schema.json`** — tạo tay trong workspace.
- **Ranh giới dữ liệu theo người dùng** dựa trên chính link `Nhân sự`: đọc bằng
  incoming links của bản ghi nhân sự (relation không filter được ở server), ghi
  thì kiểm tra lại link trước khi chạm vào bản ghi.

Bảng `Nhân sự` có cột `Tài khoản` kiểu `single_select` nguồn `workspace_users` —
đây là cầu nối giữa user của ERP và hồ sơ nhân sự. Lần đầu một người mở app, hồ
sơ của họ được tạo tự động.

## Danh tính & phân quyền

App dùng **app authority** (mô hình khuyến nghị của SDK): mọi thao tác dữ liệu
chạy bằng service account của app; `initData` chỉ để biết chắc *ai* đang thao
tác, và app tự giới hạn dữ liệu theo người đó.

Quyền app khai báo lúc boot (`src/lib/erp/app.ts`):

```
object:read · object:field:read
object:record:read · create · update · delete
```

`object:create` và `object:field:create` **không** có mặt — mini app không bao
giờ được cấp quyền đó. App chỉ *khai báo* bảng nó cần trong `schema.json`; người
deploy duyệt và áp dụng bằng quyền của chính họ.

Cài app với `role=member` (mặc định) hoặc `viewer` (chỉ đọc). `role=admin` đã bị
backend loại bỏ.

## `schema.json` — 10 bảng app cần

`src/lib/erp/schema.ts` là nguồn duy nhất: tên bảng, tên field, kiểu, option.
`schema.json` ở gốc source được **sinh ra** từ đó:

```bash
bun run schema                # ghi lại schema.json sau khi sửa schema.ts
npx erp schema check          # kiểm tra cú pháp + so với workspace thật
```

Lúc cài (hoặc upload version mới), backend so khai báo với workspace. Thiếu thứ
gì thì app dừng ở `schemaStatus: "pending"`, **không có build nào chạy**, cho tới
khi ai đó có `miniapp:manage` mở màn duyệt:

```
GET  /api/v1/mini-apps/:id/schema        → diff theo từng bảng/field
POST /api/v1/mini-apps/:id/schema/apply  → tạo phần thiếu rồi xếp hàng build
```

`resolveObjects` (`src/lib/erp/provision.ts`) chỉ *kiểm tra* lúc boot bằng
`assertSchema` — workspace lệch thì lỗi một chỗ, rõ ràng, thay vì 404 rải rác.

**Cột lookup không khai báo được** (config của chúng trỏ tới field khác bằng key
nội bộ). 8 cột lookup của app này — "Tên phòng ban", "Tên chức danh", "Tên quản
lý"… — phải tạo tay trong workspace sau khi duyệt schema; thiếu thì app vẫn chạy,
chỉ log cảnh báo và danh sách không hiện sẵn tên bản ghi liên kết.

## Chạy local

```bash
bun install
cp .env.local.example .env.local   # rồi điền hai biến bên dưới
bun run dev
```

`.env.local`:

```
ERP_BASE_URL=https://<erp>
ERP_API_KEY=erp_sk_...      # API key service account của chính mini app này
```

Hai biến đó là toàn bộ cấu hình của app — không có biến nào khác.

- **Mở app từ trong ERP** (đăng ký mini app trỏ tới `http://localhost:<port>`).
  App chủ đưa initData vào iframe, mọi thứ chạy đúng như production.
  `ERP_API_KEY` **phải là key của service account thuộc chính mini app đó** —
  ERP chỉ cho đúng key ấy đổi initData lấy phiên.
- **Chạy standalone** (mở thẳng `localhost` ngoài ERP): không có initData nên
  mọi request trả 401. Muốn test thì tự mint initData bằng token user thật
  (`POST /auth/miniapp/init-data` với `serviceAccountId` của SA app) rồi mở
  `http://localhost:<port>/#erpInitData=<urlencoded>`.

Kiểm tra toàn bộ tầng dữ liệu trên workspace thật (tự dọn dẹp bản ghi đã tạo):

```bash
ERP_API_KEY=erp_uk_... bun run smoke
```

Script này thao tác dưới danh tính chủ sở hữu `ERP_API_KEY`, nên cần key của
**người dùng thật** — app từ chối tạo hồ sơ nhân sự cho service account.

## Triển khai lên ERP

```bash
bun run schema         # schema.json khớp với schema.ts
bun run build          # kiểm tra build sạch trước khi đóng gói
zip -r hr.zip . -x "node_modules/*" -x ".next/*" -x ".git/*" -x ".env*"

curl -X POST "$ERP/api/v1/mini-apps" \
  -H "Authorization: Bearer <admin token>" -H "X-Workspace-Id: <ws>" \
  -F "name=HR" -F "port=3000" -F "role=member" \
  -F "file=@hr.zip;type=application/zip"
```

Response có `schemaStatus: "pending"` nghĩa là zip đã lên nhưng chưa build: mở
màn duyệt schema, áp dụng, rồi mới poll build như thường.

Không cần cấu hình gì thêm sau khi cài: cầu initData nhận postMessage từ mọi
origin, nên một bản build dùng được cho mọi workspace.

Hai chi tiết bắt buộc để chạy được sau Traefik:

- `next start` lắng nghe `PORT` và bind `0.0.0.0` — đúng hợp đồng runtime của ERP.
- App được serve dưới `/apps/<slug>-<id>/` và prefix bị cắt trước khi tới
  container, nên `next.config.ts` đặt `assetPrefix: "."` cho bản production
  (mọi URL `/_next/` thành tương đối) và giữ mặc định cho `next dev`. Phía FE,
  mọi request đi qua `appUrl()` — dựng từ `location.pathname` nên đúng cả khi
  URL không có dấu `/` cuối.

## Cấu trúc mã

```
src/
├── app/
│   ├── page.tsx              vỏ SPA một route, chuyển màn hình bằng state
│   └── api/                  route handlers, mỗi file chỉ nối logic vào HTTP
├── components/
│   ├── common/               khối dùng chung: form khai báo, danh sách CRUD, trạng thái
│   ├── sections/             10 màn hình
│   └── ui/                   shadcn (mã vendor, được loại khỏi lint)
├── hooks/use-hr.ts           TanStack Query: query key, mutation, invalidate
└── lib/
    ├── api/                  withHr (danh tính), ownedCollection (CRUD theo chủ sở hữu)
    ├── client/               cầu initData phía browser + fetcher tự thử lại khi 401
    ├── domain/               zod schema dùng chung FE/BE
    └── erp/                  schema 10 bảng, provisioning, session, helper links
```

Bốn bảng con (liên hệ khẩn cấp, người phụ thuộc, bằng cấp, quá trình công tác)
dùng chung một factory `ownedCollection` ở backend và một component
`CollectionSection` ở frontend — thêm một bảng con mới chỉ là khai báo cấu hình.

## Giới hạn đã biết

- `single_select` được ERP kiểm tra theo danh sách option của chính nó. App gửi
  chuỗi thô và để ERP quyết định; nếu workspace thêm option mới, form vẫn giữ
  nguyên giá trị hiện có thay vì xoá mất.
- Danh sách tham chiếu (danh bạ, danh mục tài sản, văn bản) lấy tối đa 500 dòng
  rồi lọc phía client.
- Chưa hỗ trợ ảnh đại diện / đính kèm hồ sơ.
