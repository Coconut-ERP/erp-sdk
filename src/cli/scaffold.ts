import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { UsageError } from "./args";

export interface ScaffoldOptions {
  cwd: string;
  dir: string;
  appName?: string;
  objectName?: string;
  sdkSpec?: string;
  force?: boolean;
}

/**
 * A range like `^0.3.0` would not resolve — the package is not on npm. The
 * generated app therefore depends on the release tarball, pinned: an app's
 * lockfile keys on this URL, so it must not be the moving `latest` one. Bump it
 * with the rest of the pinned URLs when cutting a release.
 */
export const DEFAULT_SDK_SPEC =
  "https://github.com/Coconut-ERP/erp-sdk/releases/download/v0.4.0/erp-sdk.tgz";

export interface ScaffoldResult {
  dir: string;
  appName: string;
  objectName: string;
  files: string[];
}

function packageName(appName: string, dir: string): string {
  const source =
    dir === "." ? appName : (dir.split("/").filter(Boolean).pop() ?? appName);
  const slug = source
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "erp-mini-app";
}

export async function scaffoldMiniApp(
  options: ScaffoldOptions,
): Promise<ScaffoldResult> {
  const target = resolve(options.cwd, options.dir);
  const dirName = target.split("/").filter(Boolean).pop() ?? "mini-app";
  const appName = options.appName ?? dirName;
  const objectName = options.objectName ?? appName;
  const sdkSpec = options.sdkSpec ?? DEFAULT_SDK_SPEC;

  const files = templates({
    appName,
    objectName,
    sdkSpec,
    packageName: packageName(appName, options.dir),
  });

  if (!options.force) {
    for (const path of Object.keys(files)) {
      const full = resolve(target, path);
      const exists = await access(full).then(
        () => true,
        () => false,
      );
      if (exists) {
        throw new UsageError(
          `${full} already exists — pass --force to overwrite`,
        );
      }
    }
  }

  for (const [path, content] of Object.entries(files)) {
    const full = resolve(target, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }

  return { dir: target, appName, objectName, files: Object.keys(files) };
}

interface TemplateVars {
  appName: string;
  objectName: string;
  sdkSpec: string;
  packageName: string;
}

function templates(vars: TemplateVars): Record<string, string> {
  return {
    "package.json": packageJson(vars),
    "schema.json": schemaJson(vars),
    "server.js": serverJs(vars),
    "public/index.html": indexHtml(vars),
    ".env.example": envExample(),
    ".gitignore": "node_modules/\n.env\n*.tgz\n",
    "README.md": readme(vars),
  };
}

/**
 * The declaration the deployer reviews. It sits at the root of the zip; the
 * app itself never creates tables.
 */
function schemaJson(vars: TemplateVars): string {
  return `${JSON.stringify(
    {
      objects: [
        {
          name: vars.objectName,
          position: 0,
          fields: [
            { name: "Nội dung", type: "long_text", position: 0 },
            {
              name: "Người tạo",
              type: "single_select",
              config: { source: "workspace_users" },
              position: 1,
            },
            {
              name: "Trạng thái",
              type: "single_select",
              config: { source: "static", options: ["new", "done"] },
              position: 2,
            },
          ],
        },
      ],
    },
    null,
    2,
  )}\n`;
}

function packageJson(vars: TemplateVars): string {
  return `${JSON.stringify(
    {
      name: vars.packageName,
      version: "0.1.0",
      private: true,
      type: "module",
      engines: { node: ">=18" },
      scripts: { start: "node server.js" },
      dependencies: { "erp-sdk": vars.sdkSpec, express: "^4.19.2" },
    },
    null,
    2,
  )}\n`;
}

function serverJs(vars: TemplateVars): string {
  return `import { readFileSync } from "node:fs";
import express from "express";
import { createMiniApp } from "erp-sdk";

const OBJECT_NAME = ${JSON.stringify(vars.objectName)};
const PORT = Number(process.env.PORT ?? 3000);

const schema = JSON.parse(readFileSync(new URL("./schema.json", import.meta.url), "utf8"));

// The Mini App module injects ERP_BASE_URL / ERP_API_KEY / PORT at deploy time.
// Declared permissions are verified against the key on boot: a misconfigured
// deployment fails here with MissingPermissionsError, not mid-flow.
const app = await createMiniApp({
  baseUrl: process.env.ERP_BASE_URL,
  apiKey: process.env.ERP_API_KEY,
  permissions: [
    { resource: "object", action: "read" },
    { resource: "object:field", action: "read" },
    { resource: "object:record", action: "read" },
    { resource: "object:record", action: "create" },
  ],
});

const objects = await app.assertSchema(schema);
const items = objects[OBJECT_NAME];
console.log(\`[\${OBJECT_NAME}] schema ready\`);

// App-authority model: initData proves WHO is acting; every data operation
// still runs under the app's own service account (Telegram-bot style).
const sessions = new Map();

async function sessionFor(initData) {
  const cached = sessions.get(initData);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const { user, expiresIn } = await app.session(initData);
  const entry = { user, expiresAt: Date.now() + Math.max(expiresIn - 60, 60) * 1000 };
  sessions.set(initData, entry);
  return entry;
}

const server = express();
server.use(express.json());
server.use(express.static("public"));

server.use("/api", async (req, res, next) => {
  const initData = req.header("x-init-data");
  if (!initData) return res.status(401).json({ error: "Missing X-Init-Data header" });
  try {
    req.erp = await sessionFor(initData);
    next();
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

server.get("/api/me", (req, res) => {
  const { id, email, displayName, fullName } = req.erp.user;
  res.json({ id, email, displayName, fullName });
});

server.get("/api/items", async (req, res) => {
  try {
    // Per-user boundaries are the app's job under app authority.
    const records = await items
      .records()
      .where("Người tạo", "equals", req.erp.user.id)
      .fetchAll();
    res.json(records.map((record) => items.rowFromRecord(record)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

server.post("/api/items", async (req, res) => {
  const { content } = req.body ?? {};
  if (!content) return res.status(400).json({ error: "content is required" });
  try {
    const record = await items.create({
      "Nội dung": content,
      "Người tạo": req.erp.user.id,
      "Trạng thái": "new",
    });
    res.status(201).json(items.rowFromRecord(record));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

server.listen(PORT, () => console.log(\`[\${OBJECT_NAME}] listening on :\${PORT}\`));
`;
}

function indexHtml(vars: TemplateVars): string {
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${vars.appName}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; color: #1a1a2e; }
    form { display: grid; gap: .75rem; margin-bottom: 2rem; }
    textarea, button { font: inherit; padding: .5rem; border: 1px solid #ccc; border-radius: 6px; }
    button { background: #1a1a2e; color: #fff; border: 0; cursor: pointer; }
    li { padding: .4rem 0; border-bottom: 1px solid #eee; }
    #error { color: #b02a37; white-space: pre-wrap; }
  </style>
</head>
<body>
  <h1>${vars.appName}</h1>
  <p id="who">Đang xác thực…</p>
  <p id="error"></p>

  <form id="form" hidden>
    <textarea name="content" rows="2" placeholder="Nội dung" required></textarea>
    <button type="submit">Gửi</button>
  </form>
  <ul id="list"></ul>

  <script>
    // initData arrives from the host app: URL fragment on first paint, or
    // postMessage when the host embeds this app in an iframe.
    var MESSAGE_TYPE = "erp-miniapp:init-data";

    function initDataFromUrl() {
      var sources = [location.hash.slice(1), location.search.slice(1)];
      for (var i = 0; i < sources.length; i++) {
        var value = new URLSearchParams(sources[i]).get("erpInitData");
        if (value) return value;
      }
      return null;
    }

    function initDataFromHost(timeoutMs) {
      return new Promise(function (resolve) {
        var timer = setTimeout(function () { resolve(null); }, timeoutMs || 5000);
        window.addEventListener("message", function listener(event) {
          var data = event.data;
          if (!data || data.type !== MESSAGE_TYPE || !data.initData) return;
          window.removeEventListener("message", listener);
          clearTimeout(timer);
          resolve(data.initData);
        });
      });
    }

    var initData = null;

    function api(path, options) {
      options = options || {};
      options.headers = Object.assign(
        { "Content-Type": "application/json", "X-Init-Data": initData },
        options.headers || {}
      );
      return fetch(path, options).then(function (response) {
        return response.json().then(function (body) {
          if (!response.ok) throw new Error(body.error || response.statusText);
          return body;
        });
      });
    }

    function render(rows) {
      var list = document.getElementById("list");
      list.innerHTML = "";
      rows.forEach(function (row) {
        var li = document.createElement("li");
        li.textContent = row["Nội dung"] + " — " + row["Trạng thái"];
        list.appendChild(li);
      });
    }

    function fail(message) {
      document.getElementById("error").textContent = message;
    }

    (async function () {
      initData = initDataFromUrl() || (await initDataFromHost());
      if (!initData) return fail("Không nhận được initData từ app chủ. Mở app này từ ERP.");
      try {
        var me = await api("/api/me");
        document.getElementById("who").textContent = "Xin chào " + (me.displayName || me.fullName || me.email);
        document.getElementById("form").hidden = false;
        render(await api("/api/items"));
      } catch (error) {
        fail(error.message);
      }
    })();

    document.getElementById("form").addEventListener("submit", async function (event) {
      event.preventDefault();
      var content = event.target.content.value.trim();
      if (!content) return;
      try {
        await api("/api/items", { method: "POST", body: JSON.stringify({ content: content }) });
        event.target.reset();
        render(await api("/api/items"));
      } catch (error) {
        fail(error.message);
      }
    });
  </script>
</body>
</html>
`;
}

function envExample(): string {
  return `# Injected automatically when installed through the ERP Mini App module.
# Set them by hand for local development.
ERP_BASE_URL=http://localhost:8000
ERP_API_KEY=erp_sk_...
PORT=3000

# Optional. "development" turns every record write into a server-side dry run
# (validated, then rolled back) — for rehearsing an import or a bulk update.
# Unset, or "production", writes for real.
# ERP_ENV=development
`;
}

function readme(vars: TemplateVars): string {
  return `# ${vars.appName}

Mini app trên nền ERP (\`erp-sdk\`). Dữ liệu nằm trong object **${vars.objectName}**
của workspace — app không cần database riêng.

## Bảng app cần: \`schema.json\`

App **không tự tạo được bảng/field**. Nó khai báo trong \`schema.json\` ở gốc
source; người deploy xem bảng so sánh (khai báo ⟷ workspace) rồi bấm áp dụng,
backend tạo phần còn thiếu bằng quyền của chính người đó. \`assertSchema\` trong
\`server.js\` chỉ kiểm tra lúc boot và báo lỗi rõ ràng nếu workspace chưa khớp.

Kiểm tra trước khi zip bằng chính SDK (\`validateSchema\` / \`planSchema\` là hàm
thuần, không gọi mạng):

\`\`\`js
import { readFileSync } from "node:fs";
import { validateSchema, planSchema, schemaConflicts } from "erp-sdk";

const schema = JSON.parse(readFileSync("./schema.json", "utf8"));
console.log(validateSchema(schema));   // [] = cú pháp hợp lệ

// muốn so với workspace thật: npx erp schema dump --out workspace.json
const workspace = JSON.parse(readFileSync("./workspace.json", "utf8")).objects;
console.log(schemaConflicts(planSchema(schema, workspace)));
\`\`\`

Muốn đổi cấu trúc: sửa \`schema.json\`, upload version mới, người deploy duyệt
lại. Field kiểu \`formula\` / \`lookup\` / \`rollup\` không khai báo được — tạo tay
trong workspace.

## Chạy local

\`\`\`bash
npm install
cp .env.example .env        # điền ERP_BASE_URL + ERP_API_KEY
ERP_BASE_URL=... ERP_API_KEY=erp_sk_... npm start
\`\`\`

Mở \`http://localhost:3000/#erpInitData=<chuỗi initData>\` — lấy chuỗi này từ
app chủ (\`POST /api/v1/auth/miniapp/init-data\`) vì mọi route \`/api\` đều yêu
cầu header \`X-Init-Data\`.

## Kiểm tra kết nối

\`\`\`bash
npx erp doctor --require object:record:create
npx erp objects show "${vars.objectName}"
\`\`\`

## Triển khai

Zip thư mục (bỏ \`node_modules\`, **giữ \`schema.json\`**) rồi upload qua module
Mini App của ERP; nền tảng build bằng nixpacks và inject \`ERP_BASE_URL\`,
\`ERP_API_KEY\` (xoay vòng mỗi lần deploy), \`ERP_WORKSPACE_ID\`, \`PORT\`.

\`\`\`bash
zip -r ${vars.packageName}.zip . -x "node_modules/*" -x ".git/*"
\`\`\`

Cài với \`role=member\` (mặc định) — \`admin\` đã bị bỏ. App chỉ đọc/ghi record;
việc tạo bảng thuộc về bước duyệt \`schema.json\`.
`;
}
