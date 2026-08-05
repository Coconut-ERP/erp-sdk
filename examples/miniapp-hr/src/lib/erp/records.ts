import type { ErpClient, ObjectHandle, RecordDto, Row } from "erp-sdk";
import { ErpApiError } from "erp-sdk";

export interface LinkDto {
  fieldId: string;
  sourceRecordId: string;
  targetRecordId: string;
  position: number;
  createdAt: string;
}

/** `relation` values live in the links table, never in `record.data`. */
export async function relationTargets(
  handle: ObjectHandle,
  recordId: string,
  field: string,
): Promise<string[]> {
  const links = (await handle.listLinks(recordId, field)) as LinkDto[];
  return links.map((link) => link.targetRecordId);
}

export async function relationTarget(
  handle: ObjectHandle,
  recordId: string,
  field: string,
): Promise<string | null> {
  const [first] = await relationTargets(handle, recordId, field);
  return first ?? null;
}

/** Keeps a relation column at exactly one target (or none) by diffing the links. */
export async function setRelation(
  handle: ObjectHandle,
  recordId: string,
  field: string,
  targetId: string | null,
): Promise<void> {
  const current = await relationTargets(handle, recordId, field);
  for (const id of current) {
    if (id !== targetId) await handle.deleteLink(recordId, field, id);
  }
  if (targetId && !current.includes(targetId)) {
    await handle.createLink(recordId, field, targetId);
  }
}

export async function setRelations(
  handle: ObjectHandle,
  recordId: string,
  relations: Record<string, string | null | undefined>,
): Promise<void> {
  for (const [field, targetId] of Object.entries(relations)) {
    if (targetId === undefined) continue;
    await setRelation(handle, recordId, field, targetId);
  }
}

export async function readRelations<K extends string>(
  handle: ObjectHandle,
  recordId: string,
  fields: Record<K, string>,
): Promise<Record<K, string | null>> {
  const entries = Object.entries(fields) as [K, string][];
  const targets = await Promise.all(
    entries.map(([, field]) => relationTarget(handle, recordId, field)),
  );
  return Object.fromEntries(entries.map(([key], index) => [key, targets[index]])) as Record<
    K,
    string | null
  >;
}

/**
 * Ids of the child records pointing at `parentRecordId` through `childField`.
 * One request, regardless of how many children there are — `relation` columns
 * cannot be filtered server-side, so this is how a child list gets scoped.
 */
export async function incomingRecordIds(
  erp: ErpClient,
  parent: ObjectHandle,
  parentRecordId: string,
  child: ObjectHandle,
  childField: string,
): Promise<string[]> {
  const fieldId = child.field(childField).id;
  const links = await erp.http.request<LinkDto[]>(
    "GET",
    `/objects/${parent.id}/records/${parentRecordId}/links`,
    { query: { fieldId, direction: "incoming" } },
  );
  return links.map((link) => link.sourceRecordId);
}

/** Reads records by id, skipping any that vanished between the link read and now. */
export async function getRecords(
  handle: ObjectHandle,
  ids: readonly string[],
): Promise<RecordDto[]> {
  const records = await Promise.all(
    ids.map(async (id) => {
      try {
        return await handle.get(id);
      } catch (error) {
        if (error instanceof ErpApiError && error.status === 404) return null;
        throw error;
      }
    }),
  );
  return records.filter((record): record is RecordDto => record !== null);
}

/** Empty strings would be rejected by typed columns — clear them instead. */
export function writable(values: Row): Row {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, value === "" ? null : value]),
  );
}

export function sortRows<T extends Row>(
  rows: T[],
  key: string,
  direction: "asc" | "desc" = "asc",
): T[] {
  const factor = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = a[key];
    const right = b[key];
    if (left == null && right == null) return 0;
    if (left == null) return 1;
    if (right == null) return -1;
    return String(left).localeCompare(String(right), "vi") * factor;
  });
}
