import express from "express";
import { createMiniApp } from "erp-sdk";

const OBJECT_NAME = "Đơn xin nghỉ";
const PORT = Number(process.env.PORT ?? 3000);

const app = await createMiniApp({
  baseUrl: process.env.ERP_BASE_URL,
  apiKey: process.env.ERP_API_KEY,
  permissions: [
    { resource: "object", action: "read" },
    { resource: "object", action: "create" },
    { resource: "object:field", action: "read" },
    { resource: "object:field", action: "create" },
    { resource: "object:record", action: "read" },
    { resource: "object:record", action: "create" },
  ],
});

const leaves = await app.ensureObject(OBJECT_NAME, [
  { name: "Người xin nghỉ", type: "single_select", config: { source: "workspace_users" } },
  { name: "Lý do", type: "long_text" },
  { name: "Từ ngày", type: "date" },
  { name: "Đến ngày", type: "date" },
  {
    name: "Trạng thái",
    type: "single_select",
    config: { source: "static", options: ["pending", "approved", "rejected"] },
  },
]);
console.log(`[leave-request] object "${OBJECT_NAME}" ready`);

// App-authority model: initData only proves WHO the user is; every data
// operation runs with the app's own service account. Users can submit leave
// requests even when their personal IAM role could not write the object.
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
server.get("/logo.webp", (_req, res) =>
  res.sendFile("logo.webp", { root: process.cwd() }),
);

server.use("/api", async (req, res, next) => {
  const initData = req.header("x-init-data");
  if (!initData) {
    return res.status(401).json({ error: "Missing X-Init-Data header" });
  }
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

server.get("/api/leaves", async (req, res) => {
  try {
    const { user } = req.erp;
    const records = await leaves
      .records()
      .where("Người xin nghỉ", "equals", user.id)
      .fetchAll();
    const rows = records
      .map((record) => leaves.rowFromRecord(record))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

server.post("/api/leaves", async (req, res) => {
  const { reason, from, to } = req.body ?? {};
  if (!reason || !from || !to) {
    return res.status(400).json({ error: "reason, from, to are required" });
  }
  try {
    const { user } = req.erp;
    const record = await leaves.create({
      "Người xin nghỉ": user.id,
      "Lý do": reason,
      "Từ ngày": from,
      "Đến ngày": to,
      "Trạng thái": "pending",
    });
    res.status(201).json(leaves.rowFromRecord(record));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`[leave-request] listening on :${PORT}`);
});
