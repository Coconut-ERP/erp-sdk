import type { ObjectHandle, RecordDto, Row } from "erp-sdk";
import type { NextRequest } from "next/server";
import type { z } from "zod";
import type { RecordRow } from "@/lib/domain/types";
import {
  getRecords,
  incomingRecordIds,
  readRelations,
  relationTarget,
  setRelations,
  sortRows,
  writable,
} from "@/lib/erp/records";
import type { ObjectKey } from "@/lib/erp/schema";
import { notFound } from "./errors";
import { type HrContext, parseBody, withHr } from "./route";

export interface OwnedCollectionConfig<S extends z.ZodType> {
  /** Child table whose rows belong to one employee. */
  object: ObjectKey;
  /** The `relation` column on that table pointing back at "Nhân sự". */
  ownerField: string;
  schema: S;
  /** Scalar columns written from a validated payload. */
  toData: (input: z.infer<S>) => Row;
  /** Other `relation` columns, written through the links API. */
  toRelations?: (input: z.infer<S>) => Record<string, string | null | undefined>;
  /** Relation ids returned with each row so edit forms can preselect them. */
  relationFields?: Record<string, string>;
  sort?: { column: string; direction: "asc" | "desc" };
}

async function toRow<S extends z.ZodType>(
  config: OwnedCollectionConfig<S>,
  handle: ObjectHandle,
  record: RecordDto,
): Promise<RecordRow> {
  const row = handle.rowFromRecord(record) as RecordRow;
  if (!config.relationFields) return row;
  return { ...row, relations: await readRelations(handle, record.id, config.relationFields) };
}

async function requireOwned<S extends z.ZodType>(
  config: OwnedCollectionConfig<S>,
  context: HrContext,
  recordId: string,
): Promise<{ handle: ObjectHandle; record: RecordDto }> {
  const handle = context.erp.objects[config.object];
  const record = await handle.get(recordId).catch(() => null);
  if (!record) throw notFound();

  const owner = await relationTarget(handle, recordId, config.ownerField);
  if (owner !== context.employee.id) throw notFound();
  return { handle, record };
}

/**
 * CRUD over a table whose rows belong to the signed-in employee.
 *
 * Ownership is the `relation` link to "Nhân sự" — reads follow the incoming
 * links of the employee record (relation columns cannot be filtered
 * server-side) and writes re-check that link before touching anything.
 */
export function ownedCollection<S extends z.ZodType>(config: OwnedCollectionConfig<S>) {
  const listRows = async (context: HrContext): Promise<RecordRow[]> => {
    const handle = context.erp.objects[config.object];
    const ids = await incomingRecordIds(
      context.erp.app,
      context.erp.objects.employee,
      context.employee.id,
      handle,
      config.ownerField,
    );
    const records = await getRecords(handle, ids);
    const rows = await Promise.all(records.map((record) => toRow(config, handle, record)));
    return config.sort ? sortRows(rows, config.sort.column, config.sort.direction) : rows;
  };

  const createRow = async (context: HrContext, input: z.infer<S>): Promise<RecordRow> => {
    const handle = context.erp.objects[config.object];
    const record = await handle.create(writable(config.toData(input)));

    await setRelations(handle, record.id, {
      [config.ownerField]: context.employee.id,
      ...config.toRelations?.(input),
    });
    return toRow(config, handle, await handle.get(record.id));
  };

  const updateRow = async (
    context: HrContext,
    recordId: string,
    input: z.infer<S>,
  ): Promise<RecordRow> => {
    const { handle, record } = await requireOwned(config, context, recordId);

    const updated = await handle.update(record.id, writable(config.toData(input)), record.version);
    if (config.toRelations) {
      await setRelations(handle, record.id, config.toRelations(input));
    }
    return toRow(config, handle, updated);
  };

  const removeRow = async (context: HrContext, recordId: string): Promise<{ id: string }> => {
    const { handle, record } = await requireOwned(config, context, recordId);
    await handle.delete(record.id, record.version);
    return { id: record.id };
  };

  return {
    listRows,
    createRow,
    updateRow,
    removeRow,
    list: withHr(async (context) => ({ items: await listRows(context) })),
    create: withHr(async (context, request: NextRequest) =>
      createRow(context, await parseBody(request, config.schema)),
    ),
    update: withHr<{ id: string }>(async (context, request, params) =>
      updateRow(context, params.id, await parseBody(request, config.schema)),
    ),
    remove: withHr<{ id: string }>(async (context, _request, params) => ({
      ...(await removeRow(context, params.id)),
      deleted: true,
    })),
  };
}
