import { listReference } from "@/lib/api/reference";
import { withHr } from "@/lib/api/route";
import type { RecordRow } from "@/lib/domain/types";
import { getRecords, incomingRecordIds, sortRows } from "@/lib/erp/records";
import { F } from "@/lib/erp/schema";

export const dynamic = "force-dynamic";

export interface AssetsResponse {
  assignments: RecordRow[];
  catalog: RecordRow[];
}

/**
 * Assets are handed out by the company, so this is read-only: the employee sees
 * what is currently in their name plus the catalogue those items come from.
 */
export const GET = withHr(async (context): Promise<AssetsResponse> => {
  const { app, objects } = context.erp;

  const ids = await incomingRecordIds(
    app,
    objects.employee,
    context.employee.id,
    objects.assetAssignment,
    F.assetAssignment.employee,
  );

  const [records, catalog] = await Promise.all([
    getRecords(objects.assetAssignment, ids),
    listReference(objects.asset, {
      sort: { column: F.asset.name },
      columns: [
        F.asset.name,
        F.asset.code,
        F.asset.category,
        F.asset.unit,
        F.asset.status,
        F.asset.note,
      ],
    }),
  ]);

  const assignments = sortRows(
    records.map((record) => objects.assetAssignment.rowFromRecord(record) as RecordRow),
    F.assetAssignment.issuedDate,
    "desc",
  );

  return { assignments, catalog };
});
