import { listReference } from "@/lib/api/reference";
import { withHr } from "@/lib/api/route";
import type { RecordRow } from "@/lib/domain/types";
import { F } from "@/lib/erp/schema";

export const dynamic = "force-dynamic";

/**
 * Only work-facing columns leave the workspace here — identity numbers, bank
 * details and addresses stay out of the shared directory.
 */
const PUBLIC_COLUMNS = [
  F.employee.fullName,
  F.employee.code,
  F.employee.workEmail,
  F.employee.phone,
  F.employee.departmentName,
  F.employee.jobTitleName,
  F.employee.managerName,
  F.employee.workStatus,
];

export const GET = withHr(
  async (context): Promise<{ items: RecordRow[] }> => ({
    items: await listReference(context.erp.objects.employee, {
      columns: PUBLIC_COLUMNS,
      sort: { column: F.employee.fullName },
    }),
  }),
);
