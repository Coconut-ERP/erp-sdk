import { listReference } from "@/lib/api/reference";
import { withHr } from "@/lib/api/route";
import type { RecordRow } from "@/lib/domain/types";
import { F } from "@/lib/erp/schema";

export const dynamic = "force-dynamic";

export const GET = withHr(
  async (context): Promise<{ items: RecordRow[] }> => ({
    items: await listReference(context.erp.objects.policy, {
      sort: { column: F.policy.effectiveDate, direction: "desc" },
    }),
  }),
);
