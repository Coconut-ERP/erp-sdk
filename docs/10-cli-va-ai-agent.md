# 10 — CLI `erp` và làm việc với AI agent

Hai thứ trong chương này phục vụ cùng một mục đích: để **con người và AI agent
đều tự khám phá được workspace** trước khi viết dòng code đầu tiên, thay vì đoán
tên bảng, tên field rồi chết lúc runtime.

- `erp` — CLI đi kèm gói `erp-sdk`, in JSON, không cần viết script tạm.
- Skill `erp-miniapp` — gói hướng dẫn cài vào Claude Code (hoặc agent khác đọc
  được thư mục skill) để agent biết mô hình mini app, luồng initData, hai mô
  hình quyền và cú pháp CLI.

## Cài

CLI có sẵn khi cài `erp-sdk`:

```bash
npm install github:Coconut-ERP/erp-sdk
npx erp help                                    # trong project

npm install -g github:Coconut-ERP/erp-sdk       # hoặc cài global để gọi thẳng `erp`
npx github:Coconut-ERP/erp-sdk doctor           # chạy một phát, không cài
```

Cấu hình bằng env (hoặc flag tương ứng):

| Env | Flag | Ghi chú |
| --- | --- | --- |
| `ERP_BASE_URL` | `--base-url` | Ví dụ `http://localhost:8000` |
| `ERP_API_KEY` | `--api-key` | Key service account `erp_sk_…` |
| `ERP_ACCESS_TOKEN` | `--token` | Token user, dùng thay key |
| `ERP_WORKSPACE_ID` | `--workspace` | Chỉ cần khi dùng token |
| — | `--env-file .env` | Nạp từ file; env thật vẫn thắng |

## Ba lệnh dùng nhiều nhất

```bash
erp doctor                          # env + kết nối + quyền, ra {ok, checks[]}
erp objects show "Đơn xin nghỉ"     # field nào, type gì, config ra sao
erp records query "Đơn xin nghỉ" --where "Trạng thái=pending" --limit 20
```

`doctor` trả lời đúng câu hỏi hay bị vướng nhất — *key có sống không, thiếu
quyền gì*:

```jsonc
{
  "ok": false,
  "checks": [
    { "name": "base-url", "status": "ok", "detail": "http://localhost:8000" },
    { "name": "credentials", "status": "ok", "detail": "API key (erp_sk_…)" },
    { "name": "connection", "status": "ok", "detail": "7 effective permission(s)" },
    { "name": "permission object:record:create", "status": "fail",
      "detail": "not granted", "hint": "Add an IAM allow rule for object:record:create" }
  ]
}
```

```bash
erp doctor --require object:record:create --require object:field:create
```

## Quy ước output

- **Kết quả luôn là JSON trên stdout** → pipe vào `jq` hoặc để agent parse.
- Ghi chú và lỗi ra **stderr**, cũng là JSON: `{"error":{"type":…,"message":…}}`,
  kèm dữ liệu để sửa được ngay (`UnknownFieldError` có `.known` liệt kê field
  hợp lệ, `MissingPermissionsError` có `.missing`).
- Exit code: `0` OK, `1` lỗi runtime/API, `2` sai cú pháp.
- `--compact` để JSON một dòng.

```bash
erp records query "Hóa đơn" --all --compact | jq '[.records[]["Tổng tiền"]] | add'
```

## Bảng lệnh

```
erp doctor | whoami | perms list | perms check <resource> <action>
erp objects list [--fields] | show <object> | create <name> | delete <object> --yes
erp objects ensure <name> [--field "Name:type[:config]"]…      # cần key admin
erp fields types | add <object> <name> <type> [--config json] | update <object> <field> …
erp records query <object> [--where …] [--sort …] [--limit n] [--all] [--total] [--select "A,B"]
erp records count | get | create | update | delete | restore
erp links list | add | remove
erp schema dump [--out file]
erp schema check [file] [--offline]
erp schema init [file] [--object name]… [--force]
erp init [dir] [--name x] [--object x]
erp skill install [--dir path] | skill path
erp help [command] [--json]
```

Cú pháp giá trị:

- Filter: `--where "Field:operator:value"`, hoặc `--where "Field=value"` (viết
  tắt của `equals`). Lặp nhiều `--where` = AND.
- Sort: `--sort "Tổng tiền:desc"` (mặc định `asc`).
- Gán: `--set "Field=value"` (lặp được) hoặc `--data '{"Field": …}'`.
- Ép kiểu: parse được JSON thì là JSON (`42` → number, `true` → boolean), còn
  lại là string (`approved`, `2026-08-03`). Cần chính xác kiểu thì dùng `--data`.
- Field spec: `"Lý do:long_text"`, `"Người:single_select:{\"source\":\"workspace_users\"}"`,
  hoặc viết tắt select `"Trạng thái:single_select:pending,approved,rejected"`.

## Làm việc với `schema.json`

Mini app khai bảng nó cần trong `schema.json` ở gốc source; người deploy duyệt
rồi mới build ([03](03-du-lieu.md#khai-báo-schema--schemajson)). Hai lệnh đi kèm:

```bash
erp schema check                       # cú pháp (luật y hệt backend) + diff với workspace
erp schema check app/schema.json --offline    # chỉ cú pháp, không cần credential
erp schema init --object "Nhân viên" --object "Phòng ban"   # xuất bảng đang có ra schema.json
```

`schema check` trả đúng thứ màn duyệt sẽ hiện, nên biết trước app sẽ deploy
thẳng hay phải chờ duyệt:

```jsonc
{
  "ok": false,
  "checked": "workspace",
  "problems": ["Đơn nghỉ phép.Số ngày is text, the app declares number"],
  "wouldBe": "pending",              // "applied" = không có gì để duyệt
  "objects": [
    { "name": "Đơn nghỉ phép", "action": "update", "fields": [
      { "name": "Lý do", "type": "long_text", "action": "unchanged" },
      { "name": "Số ngày", "type": "number", "action": "conflict", "currentType": "text" }
    ]}
  ]
}
```

Exit code `1` khi có vấn đề → dùng thẳng trong CI trước khi đóng zip.

`schema init` đi ngược lại: dựng bảng bằng tay trong UI cho nhanh, rồi xuất ra
khai báo. Nó bỏ qua cột computed (`formula`/`lookup`/`rollup` — không khai báo
được) và đổi `targetObjectId` của relation thành `targetObject` theo tên bảng.

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
erp skill install                      # → .claude/skills/erp-miniapp
erp skill install --dir ~/.claude/skills   # dùng chung mọi project
erp skill path                         # chỉ in đường dẫn để agent tự đọc
```

Skill gồm `SKILL.md` (mô hình mini app, initData, hai mô hình quyền, checklist
debug) và `references/` (toàn bộ CLI + bề mặt SDK). Agent tự nạp khi thấy task
nhắc tới erp-sdk, mini app, object/record của ERP.

### Vì sao agent làm tốt hơn với CLI này

- `erp help --json` trả **toàn bộ command surface** dạng máy đọc — agent không
  phải đoán tên lệnh hay flag.
- `erp schema dump --out workspace.json` nạp nguyên schema workspace làm context
  → không bịa tên field.
- `erp schema check` cho agent một vòng lặp đóng: sửa `schema.json` → chạy →
  đọc `problems` → sửa tiếp, không cần upload zip mới biết sai.
- Lỗi có cấu trúc và kèm cách sửa, nên agent tự chữa được vòng lặp
  `sai tên field → đọc .known → gọi lại`.
- Flag lạ bị chặn ngay với danh sách flag hợp lệ, thay vì im lặng bỏ qua.

### Quy trình gợi ý cho agent

1. `erp doctor` — chắc chắn có kết nối và đủ quyền trước khi làm gì.
2. `erp objects list` / `erp schema dump` — nắm dữ liệu thật đang có.
3. `erp init …` — sinh khung app, rồi sửa code.
4. `erp schema check` — khai báo hợp lệ chưa, deploy có phải chờ duyệt không.
5. `erp records query/create` — kiểm chứng luồng dữ liệu trước khi tin vào UI.

Đừng để app tự gọi `objects create` / `objects ensure` lúc boot: service
account của mini app không có quyền đó, chỉ nhận `403`.

### Ranh giới an toàn

- CLI **không bao giờ** in API key ra output; đừng dán key vào lệnh trong
  transcript — dùng env hoặc `--env-file`.
- `objects delete` bắt buộc `--yes` (xóa bảng là xóa cả record).
- `records delete` là soft delete — hoàn tác bằng `records restore --version`.
- Mọi thao tác chạy bằng quyền của key đang cấu hình. Muốn agent chỉ đọc, cấp
  cho nó một service account chỉ có `*:read`.
