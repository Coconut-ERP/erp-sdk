# 10 — CLI `erp` và làm việc với AI agent

Hai thứ trong chương này phục vụ cùng một mục đích: để **con người và AI agent
đều tự khám phá được workspace** trước khi viết dòng code đầu tiên, thay vì đoán
tên bảng, tên field rồi chết lúc runtime.

- `erp` — CLI đi kèm gói `erp-sdk`: dựng môi trường, kiểm kết nối/quyền, in
  schema thật. **Không có lệnh CRUD dữ liệu.**
- Skill `erp-data` — gói hướng dẫn cài vào Claude Code (hoặc agent khác đọc được
  thư mục skill) để agent biết dùng SDK đọc/ghi/phân tích dữ liệu ERP.

## Vì sao CLI không làm CRUD

Có một thời CLI này có đủ `records query/create/update/delete`, `fields add`,
`links add`… Bỏ hết, vì mọi việc thật đều nhiều bước: lọc rồi đối chiếu, join hai
bảng, đếm trước khi ghi, tổng hợp theo tháng. Diễn đạt chuỗi đó bằng cờ dòng lệnh
vừa dài vừa mất dữ liệu trung gian, trong khi cùng logic viết bằng SDK là mươi
dòng đọc được, chạy lại được, và test được.

Nên phân vai: **CLI dựng sân, SDK chơi bóng.**

```bash
erp doctor                              # sân có ổn không
erp schema dump --out workspace.json    # sân trông thế nào
node --env-file=.env bao-cao.mjs        # ← việc thật nằm ở đây
```

## Cài

CLI có sẵn khi cài `erp-sdk`:

```bash
BASE=https://github.com/Coconut-ERP/erp-sdk/releases/download

npm install "$BASE/v0.3.1/erp-sdk.tgz"   # trong project: ghim version
npx erp help

npm install -g "$BASE/latest/erp-sdk.tgz"   # global: URL không bao giờ phải sửa
erp help
```

Tag `latest` được trỏ lại sau mỗi lần phát hành nên hợp với máy mới và CLI
global; còn dependency của app thì ghim `v0.3.1` — package manager khoá theo URL,
URL chạy được mãi thì cài lại không còn tái lập được.

Cấu hình bằng env (hoặc flag tương ứng):

| Env | Flag | Ghi chú |
| --- | --- | --- |
| `ERP_BASE_URL` | `--base-url` | Ví dụ `http://localhost:8000` |
| `ERP_API_KEY` | `--api-key` | Key service account `erp_sk_…` |
| `ERP_ACCESS_TOKEN` | `--token` | Token user, dùng thay key |
| `ERP_WORKSPACE_ID` | `--workspace` | Chỉ cần khi dùng token |
| — | `--env-file .env` | Nạp từ file; env thật vẫn thắng |

## Toàn bộ bảng lệnh

```
erp doctor [--require resource:action]…
erp whoami
erp objects list [--fields]
erp objects show <object>
erp schema dump [--out file]
erp init [dir] [--name x] [--object x] [--sdk spec] [--force]
erp skill install [--dir path] [--force] | erp skill path
erp help [command] [--json]
```

Hết. Đọc/ghi record, thêm field, tạo link, phân tích → viết script SDK
([03](03-du-lieu.md), [04](04-dataframe.md)).

## `doctor` — câu hỏi hay vướng nhất

*Key có sống không, thiếu quyền gì:*

```jsonc
{
  "ok": false,
  "checks": [
    { "name": "base-url", "status": "ok", "detail": "http://localhost:8000" },
    { "name": "credentials", "status": "ok", "detail": "API key (erp_sk_…)" },
    { "name": "connection", "status": "ok", "detail": "7 effective permission(s)" },
    { "name": "objects", "status": "ok", "detail": "12 object(s) visible" },
    { "name": "permission object:record:create", "status": "fail",
      "detail": "not granted", "hint": "Add an IAM allow rule for object:record:create" }
  ]
}
```

```bash
erp doctor --require object:record:create --require object:field:read
```

Exit `1` khi có check hỏng → dùng thẳng trong CI hoặc script khởi động.

`erp whoami` bổ sung góc nhìn còn lại: key này *là ai* và đang có **những rule
nào** (kể cả row scope) — nơi để nhìn khi đọc ra 0 record dù bảng có dữ liệu.

## Xem schema thật

```bash
erp objects list                      # id, name, position
erp objects list --fields             # kèm field (1 request/bảng)
erp objects show "Đơn xin nghỉ"       # 1 bảng, đủ type + config
erp schema dump --out workspace.json  # cả workspace, để nạp làm context
```

`schema dump` in `{ objects: [{ id, name, fields: [{ key, name, type, config,
position, isArchived }] }] }` — đọc `config` để biết `relation` trỏ bảng nào,
`single_select` có option gì, `source: "workspace_users"` (giá trị là user id).

Output này cũng chính là dạng `planSchema(schema, workspace)` nhận vào, nên so
`schema.json` với workspace thật làm được offline:

```js
import { readFileSync } from "node:fs";
import { validateSchema, planSchema, schemaConflicts } from "erp-sdk";

const schema = JSON.parse(readFileSync("schema.json", "utf8"));
console.log(validateSchema(schema));                       // [] = cú pháp hợp lệ

const workspace = JSON.parse(readFileSync("workspace.json", "utf8")).objects;
console.log(schemaConflicts(planSchema(schema, workspace)));  // [] = không xung đột kiểu
```

Có credential thì gọn hơn nữa: `client.schemaPlan(schema)` (diff như màn duyệt,
không ném lỗi) hoặc `client.assertSchema(schema)` (ném `SchemaMismatchError`).

## Quy ước output

- **Kết quả luôn là JSON trên stdout** → pipe vào `jq` hoặc để agent parse.
- Ghi chú và lỗi ra **stderr**, cũng là JSON: `{"error":{"type":…,"message":…}}`,
  kèm dữ liệu để sửa được ngay (`UnknownObjectError` có `.object`,
  `MissingPermissionsError` có `.missing`).
- Exit code: `0` OK, `1` lỗi runtime/API, `2` sai cú pháp.
- `--compact` để JSON một dòng.

```bash
erp schema dump --compact | jq '[.objects[] | {name, fields: (.fields | length)}]'
```

## Dựng app mới trong một lệnh

```bash
erp init don-xin-nghi --name "Đơn xin nghỉ" --object "Đơn xin nghỉ"
cd don-xin-nghi && npm install
ERP_BASE_URL=… ERP_API_KEY=erp_sk_… npm start
```

Sinh ra `schema.json` (bảng app khai báo), `server.js` (Express +
`createMiniApp` + `assertSchema` + verify initData), `public/index.html` (bridge
initData, form, danh sách), `.env.example`, `README.md`. Chạy được ngay, sửa dần
thành app thật.

Trong lúc `erp-sdk` chưa publish registry, trỏ dependency vào path local:

```bash
erp init don-xin-nghi --sdk "file:../erp-sdk"
```

## Cho AI agent

### Cài skill

```bash
erp skill install                        # → ~/.agents/skills/erp-data
erp skill install --dir .claude/skills   # hoặc bó gọn trong một repo
erp skill path                           # chỉ in đường dẫn để agent tự đọc
```

Mặc định cài **một bản cho cả máy**, ở thư mục không thuộc riêng tool nào, rồi in
sẵn cách nối cho từng agent. Claude Code là công cụ duy nhất tự nạp `SKILL.md`,
và chỉ nạp từ thư mục của nó — nên nó cần symlink; các tool còn lại đọc
`AGENTS.md` nên chỉ cần một dòng trỏ tới đúng file đó:

```bash
mkdir -p ~/.claude/skills
ln -sfn ~/.agents/skills/erp-data ~/.claude/skills/erp-data     # claude
```

```markdown
<!-- AGENTS.md ở gốc repo (hoặc ~/.codex/AGENTS.md cho mọi repo) — codex, opencode, pi -->
ERP data tasks (erp-sdk, object/field/record, ERP_API_KEY):
read ~/.agents/skills/erp-data/SKILL.md first.
```

Một bản duy nhất nên `erp skill install --force` sau khi nâng SDK là mọi agent
cùng thấy bản mới; không có chuyện bốn bản chép rời nhau rồi lệch dần.

Skill `erp-data` dạy agent **dùng SDK khai thác dữ liệu**: kết nối, đọc schema
thật, query có filter/sort/phân trang, tránh N+1 khi đi qua `relation`, tổng hợp
bằng `DataFrame`, ghi và ghi hàng loạt an toàn, đọc lỗi để tự sửa. Gồm `SKILL.md`
+ `references/api.md` (bề mặt SDK) + `references/recipes.md` (script chạy được:
báo cáo, join, import CSV, dọn dữ liệu).

Dựng **mini app** là chủ đề khác — bộ `docs/` này (01→09) mới là nguồn cho việc
đó; chỉ cho agent đọc `docs/` khi task đúng là làm mini app.

### Quy trình gợi ý cho agent

1. `erp doctor` — chắc chắn có kết nối và đủ quyền trước khi làm gì.
2. `erp schema dump --out workspace.json` — nắm tên bảng/field thật.
3. Viết script SDK, chạy `node --env-file=.env script.mjs`, đọc kết quả.
4. Script có ghi: chạy `.count()` trước, in thử payload, chỉ ghi thật sau khi
   người dùng xác nhận.

### Ranh giới an toàn

- CLI **không bao giờ** in API key ra output; đừng dán key vào lệnh trong
  transcript — dùng env hoặc `--env-file`.
- Muốn agent chỉ đọc, cấp cho nó một service account chỉ có `*:read`. Đó là
  hàng rào chắc chắn hơn mọi quy ước trong prompt.
- Xóa record qua SDK là **soft delete** (`handle.restore(id, version)` để hoàn
  tác); xóa object thì mất cả record — service account `member` không làm được
  việc đó, và cũng không nên làm hộ người dùng.
- Bulk update chạm tới hàng nghìn dòng trong một request: đếm trước, hỏi trước.
