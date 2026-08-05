import { createMiniApp, type ErpClient, type RequiredPermission } from "erp-sdk";
import { type HrObjects, resolveObjects } from "./provision";

export interface HrErp {
  app: ErpClient;
  objects: HrObjects;
}

/**
 * What the app needs to serve a request — the boot fails fast if the key is
 * missing any of it. Schema rights (`object:create`, `object:field:create`) are
 * absent because a mini app never has them: the tables it declares in
 * `schema.json` are created by whoever deploys it, under their own authority.
 */
const PERMISSIONS: RequiredPermission[] = [
  { resource: "object", action: "read" },
  { resource: "object:field", action: "read" },
  { resource: "object:record", action: "read" },
  { resource: "object:record", action: "create" },
  { resource: "object:record", action: "update" },
  { resource: "object:record", action: "delete" },
];

let booting: Promise<HrErp> | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Thiếu biến môi trường ${name}. ERP tự inject biến này khi deploy mini app; chạy local thì đặt trong .env.local.`,
    );
  }
  return value;
}

async function boot(): Promise<HrErp> {
  const app = await createMiniApp({
    baseUrl: requireEnv("ERP_BASE_URL"),
    apiKey: requireEnv("ERP_API_KEY"),
    permissions: PERMISSIONS,
  });

  return { app, objects: await resolveObjects(app) };
}

/**
 * One ERP client per process, created on the first request. A failed boot is not
 * memoised, so a transient ERP outage does not poison the container for good.
 */
export function getErp(): Promise<HrErp> {
  if (!booting) {
    booting = boot().catch((error: unknown) => {
      booting = null;
      throw error;
    });
  }
  return booting;
}
