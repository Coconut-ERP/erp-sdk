import { employeeRow, profileCompletion } from "@/lib/api/employee";
import { withHr } from "@/lib/api/route";
import type { MeResponse } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

export const GET = withHr(async (context): Promise<MeResponse> => {
  const employee = await employeeRow(context);
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
