import { employeeRow, profileCompletion } from "@/lib/api/employee";
import { parseBody, withHr } from "@/lib/api/route";
import { profileSchema } from "@/lib/domain/schemas";
import type { MeResponse } from "@/lib/domain/types";
import { setRelations, writable } from "@/lib/erp/records";
import { F } from "@/lib/erp/schema";

export const dynamic = "force-dynamic";

export const PUT = withHr(async (context, request): Promise<MeResponse> => {
  const input = await parseBody(request, profileSchema);
  const handle = context.erp.objects.employee;

  const updated = await handle.update(
    context.employee.id,
    writable({
      [F.employee.fullName]: input.fullName,
      [F.employee.code]: input.code,
      [F.employee.workEmail]: input.workEmail,
      [F.employee.phone]: input.phone,
      [F.employee.birthDate]: input.birthDate,
      [F.employee.gender]: input.gender,
      [F.employee.idNumber]: input.idNumber,
      [F.employee.idIssuedDate]: input.idIssuedDate,
      [F.employee.idIssuedPlace]: input.idIssuedPlace,
      [F.employee.maritalStatus]: input.maritalStatus,
      [F.employee.permanentAddress]: input.permanentAddress,
      [F.employee.currentAddress]: input.currentAddress,
      [F.employee.taxCode]: input.taxCode,
      [F.employee.socialInsuranceNumber]: input.socialInsuranceNumber,
      [F.employee.bankAccount]: input.bankAccount,
      [F.employee.bankName]: input.bankName,
      [F.employee.joinDate]: input.joinDate,
      [F.employee.contractType]: input.contractType,
      [F.employee.workStatus]: input.workStatus,
    }),
    context.employee.version,
  );

  await setRelations(handle, updated.id, {
    [F.employee.department]: input.departmentId || null,
    [F.employee.jobTitle]: input.jobTitleId || null,
    // Nobody may report to themselves — that would also break the manager lookup.
    [F.employee.manager]:
      input.managerId && input.managerId !== updated.id ? input.managerId : null,
  });

  const employee = await employeeRow(context, await handle.get(updated.id));
  const { id, email, displayName, fullName } = context.user;

  return {
    user: {
      id,
      email,
      displayName: displayName ?? fullName ?? email,
      fullName: fullName ?? null,
    },
    employee,
    profileCompletion: profileCompletion(employee),
  };
});
