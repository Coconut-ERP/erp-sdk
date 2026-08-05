/**
 * Writes `schema.json` from the single source of truth in
 * `src/lib/erp/schema.ts`, so the declaration the deployer reviews cannot
 * drift from the names the app reads and writes.
 *
 *   bun run scripts/schema.ts       (npm run schema)
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateSchema } from "erp-sdk";
import { declaration } from "../src/lib/erp/schema";

const schema = declaration();
const problems = validateSchema(schema);
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}

const target = resolve(import.meta.dirname, "../schema.json");
writeFileSync(target, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
console.log(
  `schema.json: ${schema.objects.length} bảng, ` +
    `${schema.objects.reduce((total, object) => total + (object.fields?.length ?? 0), 0)} field`,
);
