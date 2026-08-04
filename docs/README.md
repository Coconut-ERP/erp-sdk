# Tài liệu erp-sdk — xây mini app trên nền ERP

Bộ tài liệu này hướng dẫn **từ số 0 đến một mini app chạy thật** trên nền ERP:
viết app bằng TypeScript/JavaScript (hoặc bất kỳ ngôn ngữ nào — SDK chỉ là
lớp tiện ích trên REST API), cài vào workspace, và nhận diện người dùng đang
thao tác.

## Đọc theo thứ tự nào?

**Lần đầu làm mini app** — đọc lần lượt:

1. [Tổng quan & kiến trúc](01-tong-quan.md) — mini app là gì, chạy ở đâu,
   xác thực kiểu gì. Đọc trước để không mơ hồ về mô hình.
2. [Bắt đầu: mini app đầu tiên](02-bat-dau.md) — dựng project, chạy local,
   đóng gói và cài lên ERP trong ~15 phút.
3. [Hướng dẫn từng bước: app "Đơn xin nghỉ"](09-tutorial-leave-request.md) —
   tutorial hoàn chỉnh một app thật: form + bảng dữ liệu + danh tính user.

**Dùng terminal hoặc AI agent** — [CLI `erp` & AI agent](10-cli-va-ai-agent.md):
`erp doctor` để chẩn đoán kết nối/quyền, `erp objects show` để xem schema thật,
`erp init` để sinh app chạy được, `erp skill install` để agent nắm cách làm.

**Tra cứu khi viết code:**

| Tài liệu | Nội dung |
| --- | --- |
| [03 — Làm việc với dữ liệu](03-du-lieu.md) | Object, field, record: CRUD, query (filter/sort/phân trang), link giữa các bảng, tự tạo schema (`ensureObject`) |
| [04 — DataFrame](04-dataframe.md) | Phân tích dữ liệu kiểu pandas: `groupBy`, `agg`, `leftJoin`, `sum/avg`… |
| [05 — Danh tính người dùng (initData)](05-danh-tinh-nguoi-dung.md) | Biết ai đang dùng app: luồng initData kiểu Telegram, `session()`, bridge với app chủ, 2 mô hình quyền |
| [06 — Phân quyền](06-phan-quyen.md) | Service account, khai báo permission, `can()`/`assertPermissions()`, các tầng IAM |
| [07 — Triển khai & vận hành](07-trien-khai-van-hanh.md) | Cài app (template/repo/zip), vòng đời deploy, ENV được inject, logs, logo, lỗi thường gặp |
| [08 — API reference](08-api-reference.md) | Toàn bộ export của SDK: chữ ký hàm, kiểu dữ liệu, error |
| [10 — CLI `erp` & AI agent](10-cli-va-ai-agent.md) | Khám phá workspace từ terminal (`doctor`, `objects show`, `records query`), sinh app bằng `erp init`, cài skill cho agent |

## Bức tranh 30 giây

```
┌─ App chủ (ERP frontend) ────────────────────────────────┐
│  user bấm mở app ──► xin initData (chuỗi đã ký, 5 phút) │
│                          │                              │
│                          ▼ iframe + initData            │
│               ┌─ Mini app của bạn ─────────────┐        │
│               │ FE: nhận initData, gửi kèm     │        │
│               │     request về server của app  │        │
│               │ BE: createMiniApp(ERP_API_KEY) │        │
│               │     app.session(initData)      │        │
│               │       → biết chắc user là ai   │        │
│               │     app.object("...").create() │        │
│               │       → đọc/ghi dữ liệu ERP    │        │
│               └────────────────────────────────┘        │
└─────────────────────────────────────────────────────────┘
```

- Mini app là một web app bình thường (Express, Fastify, Next.js…), được ERP
  build bằng **nixpacks** và chạy thành container sau **Traefik**.
- App xác thực với ERP bằng **API key của service account riêng**
  (`erp_sk_…`, ERP tự tạo lúc cài, tự xoay vòng mỗi lần deploy).
- App biết **ai** đang thao tác qua **initData** — chuỗi đã ký do app chủ
  đưa vào, đổi được thành danh tính user đã xác minh. App chủ **không bao
  giờ** đưa token của user cho mini app.
- Dữ liệu của app nằm trong **object engine** của ERP (bảng + field + record
  trong workspace) — app không cần database riêng.

## Cài đặt SDK

```bash
npm install erp-sdk          # khi đã publish registry
npm install ../erp-sdk       # hoặc path local trong lúc phát triển
```

Yêu cầu Node 18+ (dùng `fetch` toàn cục). Chạy được cả trong browser, nhưng
API key `erp_sk_…` **chỉ được nằm ở server** — không bao giờ ship xuống
browser.

## Quy ước trong tài liệu

- `<ERP>` = base URL của backend ERP (ví dụ `http://localhost:8000`).
  Mọi endpoint REST đều nằm dưới `<ERP>/api/v1`; SDK tự thêm prefix này.
- Code mẫu dùng ESM (`import`) và top-level `await` (Node 18+, `"type":
  "module"` trong package.json).
- Tên object/field trong ví dụ để tiếng Việt có dấu — object engine dùng
  **display name** làm địa chỉ, SDK tự resolve sang key nội bộ.
