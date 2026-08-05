import type { RecordDto } from "erp-sdk";
import type { RecordRow } from "@/lib/domain/types";
import { readRelations } from "@/lib/erp/records";
import { F } from "@/lib/erp/schema";
import type { HrContext } from "./route";

export const EMPLOYEE_RELATIONS = {
  departmentId: F.employee.department,
  jobTitleId: F.employee.jobTitle,
  managerId: F.employee.manager,
} as const;

/** Columns a complete profile is expected to carry, used for the progress hint. */
const COMPLETION_COLUMNS: string[] = [
  F.employee.fullName,
  F.employee.workEmail,
  F.employee.phone,
  F.employee.birthDate,
  F.employee.gender,
  F.employee.idNumber,
  F.employee.permanentAddress,
  F.employee.currentAddress,
  F.employee.taxCode,
  F.employee.socialInsuranceNumber,
  F.employee.bankAccount,
  F.employee.bankName,
  F.employee.joinDate,
  F.employee.contractType,
  F.employee.departmentName,
  F.employee.jobTitleName,
];

export function profileCompletion(row: RecordRow): number {
  const filled = COMPLETION_COLUMNS.filter((column) => {
    const value = row[column];
    return value !== null && value !== undefined && String(value).trim() !== "";
  }).length;
  return Math.round((filled / COMPLETION_COLUMNS.length) * 100);
}

export async function employeeRow(context: HrContext, record?: RecordDto): Promise<RecordRow> {
  const handle = context.erp.objects.employee;
  const source = record ?? context.employee;
  const row = handle.rowFromRecord(source) as RecordRow;
  return {
    ...row,
    relations: await readRelations(handle, source.id, EMPLOYEE_RELATIONS),
  };
}
