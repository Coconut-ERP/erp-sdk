import type { ErpClient, ObjectHandle } from "erp-sdk";
import { declaration, LOOKUP_FIELDS, OBJECTS, type ObjectKey, OBJECT_KEYS } from "./schema";

export type HrObjects = Record<ObjectKey, ObjectHandle>;

function hasField(handle: ObjectHandle, name: string): boolean {
  const wanted = name.toLowerCase();
  return handle.fields.some((field) => field.name.toLowerCase() === wanted);
}

/**
 * Resolves the ten HR tables — it never creates them.
 *
 * The app declares what it needs in `schema.json`; the person deploying it
 * reviews that declaration and applies it with their own permissions, before
 * the first build runs. So by the time this code executes the workspace either
 * matches or the deploy was never approved, and `assertSchema` turns the second
 * case into one readable error instead of a 404 per route.
 *
 * Lookup columns are the exception: they cannot be declared (their config
 * addresses other fields by internal key), so they are optional here — a
 * missing one only costs the pre-joined name in list views.
 */
export async function resolveObjects(app: ErpClient): Promise<HrObjects> {
  const byName = await app.assertSchema(declaration());

  const objects = {} as HrObjects;
  for (const key of OBJECT_KEYS) {
    const handle = byName[OBJECTS[key]];
    if (!handle) throw new Error(`Bảng "${OBJECTS[key]}" không có trong khai báo schema.json`);
    objects[key] = handle;
  }

  const missingLookups = LOOKUP_FIELDS.filter(
    (spec) => !hasField(objects[spec.object], spec.field),
  );
  if (missingLookups.length > 0) {
    console.warn(
      `[hr] thiếu ${missingLookups.length} cột lookup: ` +
        `${missingLookups.map((spec) => `${OBJECTS[spec.object]}.${spec.field}`).join(", ")}. ` +
        "Cột lookup không khai báo được trong schema.json — tạo tay trong workspace " +
        "(trỏ qua field relation tương ứng) để danh sách hiện sẵn tên bản ghi liên kết.",
    );
  }

  return objects;
}
