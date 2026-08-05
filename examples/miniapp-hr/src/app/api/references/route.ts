import { listReference } from "@/lib/api/reference";
import { withHr } from "@/lib/api/route";
import type { RecordRow, ReferenceOption } from "@/lib/domain/types";
import { F } from "@/lib/erp/schema";

export const dynamic = "force-dynamic";

export interface ReferencesResponse {
  departments: RecordRow[];
  jobTitles: RecordRow[];
  colleagues: ReferenceOption[];
}

/** Everything the pickers need: org units, job titles and who can be a manager. */
export const GET = withHr(async (context): Promise<ReferencesResponse> => {
  const { objects } = context.erp;

  const [departments, jobTitles, employees] = await Promise.all([
    listReference(objects.department, {
      sort: { column: F.department.name },
      columns: [
        F.department.name,
        F.department.code,
        F.department.description,
        F.department.parentName,
      ],
    }),
    listReference(objects.jobTitle, {
      sort: { column: F.jobTitle.name },
      columns: [F.jobTitle.name, F.jobTitle.code, F.jobTitle.level, F.jobTitle.description],
    }),
    listReference(objects.employee, {
      sort: { column: F.employee.fullName },
      columns: [F.employee.fullName, F.employee.code, F.employee.jobTitleName],
    }),
  ]);

  const colleagues: ReferenceOption[] = employees
    .filter((row) => row.id !== context.employee.id)
    .map((row) => ({
      id: row.id,
      label: String(row[F.employee.fullName] ?? "Chưa đặt tên"),
      hint:
        [row[F.employee.code], row[F.employee.jobTitleName]].filter(Boolean).join(" · ") ||
        undefined,
    }));

  return { departments, jobTitles, colleagues };
});
