import type { ObjectHandle } from "erp-sdk";
import type { RecordRow } from "@/lib/domain/types";
import { sortRows } from "@/lib/erp/records";

const MAX_ROWS = 500;

interface ListOptions {
  /** Whitelist of columns to expose — anything else stays inside the workspace. */
  columns?: string[];
  sort?: { column: string; direction?: "asc" | "desc" };
  max?: number;
}

function project(row: RecordRow, columns?: string[]): RecordRow {
  if (!columns) return row;
  const picked: RecordRow = {
    id: row.id,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  for (const column of columns) picked[column] = row[column] ?? null;
  return picked;
}

/** Reads a whole reference table (small by nature) as plain rows. */
export async function listReference(
  handle: ObjectHandle,
  options: ListOptions = {},
): Promise<RecordRow[]> {
  const records = await handle.records().fetchAll({ max: options.max ?? MAX_ROWS });
  const rows = records.map((record) =>
    project(handle.rowFromRecord(record) as RecordRow, options.columns),
  );
  return options.sort ? sortRows(rows, options.sort.column, options.sort.direction ?? "asc") : rows;
}
