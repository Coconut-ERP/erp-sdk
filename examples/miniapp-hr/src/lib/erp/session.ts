import { ErpApiError, type RecordDto, type UserDto } from "erp-sdk";
import { getErp, type HrErp } from "./app";
import { F } from "./schema";

interface CachedSession {
  user: UserDto;
  expiresAt: number;
}

const SESSION_CACHE_LIMIT = 500;
const EMPLOYEE_CACHE_TTL_MS = 5 * 60_000;

const sessions = new Map<string, CachedSession>();
const employeeIds = new Map<string, { id: string; expiresAt: number }>();
const pendingEmployees = new Map<string, Promise<RecordDto>>();

function prune(): void {
  const now = Date.now();
  for (const [key, value] of sessions) {
    if (value.expiresAt <= now) sessions.delete(key);
  }
  if (sessions.size > SESSION_CACHE_LIMIT) sessions.clear();
}

/**
 * Trades a signed initData string for a verified user. Cached per string so a
 * burst of requests from one open app costs a single exchange with the ERP.
 */
export async function resolveUser(initData: string): Promise<UserDto> {
  const cached = sessions.get(initData);
  if (cached && cached.expiresAt > Date.now()) return cached.user;

  const { app } = await getErp();
  const { user, expiresIn } = await app.session(initData);
  prune();
  sessions.set(initData, {
    user,
    expiresAt: Date.now() + Math.max(expiresIn - 60, 60) * 1000,
  });
  return user;
}

/** ERP mints service accounts under this domain; they are machines, not staff. */
const SERVICE_ACCOUNT_DOMAIN = "@service-accounts.internal";

async function findOrCreateEmployee(erp: HrErp, user: UserDto): Promise<RecordDto> {
  const employees = erp.objects.employee;
  const existing = await employees.records().where(F.employee.account, "equals", user.id).first();
  if (existing) return existing;

  if (user.email.endsWith(SERVICE_ACCOUNT_DOMAIN)) {
    throw new Error(
      `${user.email} là service account, không phải nhân viên — cổng thông tin chỉ mở cho người dùng thật.`,
    );
  }

  return employees.create({
    [F.employee.account]: user.id,
    [F.employee.fullName]: user.fullName ?? user.displayName ?? user.email,
    [F.employee.workEmail]: user.email,
    [F.employee.phone]: user.phoneNumber ?? null,
    [F.employee.workStatus]: "Đang làm việc",
  });
}

/**
 * The "Nhân sự" row that belongs to the signed-in user, created on first visit
 * so the portal is usable the moment someone opens it. Concurrent first
 * requests share one creation instead of racing into duplicate rows.
 */
export async function resolveEmployee(user: UserDto): Promise<{ erp: HrErp; employee: RecordDto }> {
  const erp = await getErp();
  const cached = employeeIds.get(user.id);

  if (cached && cached.expiresAt > Date.now()) {
    try {
      return { erp, employee: await erp.objects.employee.get(cached.id) };
    } catch (error) {
      if (!(error instanceof ErpApiError) || error.status !== 404) throw error;
      employeeIds.delete(user.id);
    }
  }

  let pending = pendingEmployees.get(user.id);
  if (!pending) {
    pending = findOrCreateEmployee(erp, user).finally(() => pendingEmployees.delete(user.id));
    pendingEmployees.set(user.id, pending);
  }

  const employee = await pending;
  employeeIds.set(user.id, { id: employee.id, expiresAt: Date.now() + EMPLOYEE_CACHE_TTL_MS });
  return { erp, employee };
}
