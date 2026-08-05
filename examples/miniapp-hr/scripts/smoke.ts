import { EMPLOYEE_RELATIONS, employeeRow, profileCompletion } from "@/lib/api/employee";
import { listReference } from "@/lib/api/reference";
import type { HrContext } from "@/lib/api/route";
import {
  dependents,
  emergencyContacts,
  qualifications,
  workHistory,
} from "@/lib/api/collections";
import { getErp } from "@/lib/erp/app";
import { getRecords, incomingRecordIds, readRelations, setRelations, writable } from "@/lib/erp/records";
import { F } from "@/lib/erp/schema";
import { resolveEmployee } from "@/lib/erp/session";
import { text } from "@/lib/format";

/**
 * Exercises the whole data layer against a real workspace: the schema check, the
 * employee anchor, every owned collection and the read-only reference lists.
 * Records created here are removed again; the tables and the employee row stay.
 *
 *   ERP_BASE_URL=… ERP_API_KEY=… bun run smoke
 */

let failures = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${label}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

console.log("• Booting mini app (checking schema.json against the workspace)…");
const erp = await getErp();
check("all 10 HR tables exist", Object.keys(erp.objects).length === 10);

const user = await erp.app.me();
const { employee } = await resolveEmployee(user);
const context: HrContext = { erp, user, employee };
console.log(`• Acting as ${user.email} → employee record ${employee.id}`);

console.log("• Reference data");
const departments = await listReference(erp.objects.department, { sort: { column: F.department.name } });
const jobTitles = await listReference(erp.objects.jobTitle, { sort: { column: F.jobTitle.name } });
check("departments readable", Array.isArray(departments));
check("job titles readable", Array.isArray(jobTitles));

console.log("• Seeding one department + job title for the relation checks");
const department = await erp.objects.department.create({
  [F.department.name]: "ZZ Smoke — Phòng thử nghiệm",
  [F.department.code]: "ZZ-SMOKE",
});
const jobTitle = await erp.objects.jobTitle.create({
  [F.jobTitle.name]: "ZZ Smoke — Chuyên viên thử nghiệm",
  [F.jobTitle.level]: "Chuyên viên",
});

console.log("• Profile: scalar write + relation links");
await erp.objects.employee.update(
  employee.id,
  writable({ [F.employee.phone]: "0900000001", [F.employee.gender]: "Nam" }),
  employee.version,
);
await setRelations(erp.objects.employee, employee.id, {
  [F.employee.department]: department.id,
  [F.employee.jobTitle]: jobTitle.id,
});

const relations = await readRelations(erp.objects.employee, employee.id, EMPLOYEE_RELATIONS);
check("department link stored", relations.departmentId === department.id, relations);
check("job title link stored", relations.jobTitleId === jobTitle.id, relations);

console.log("• Waiting for the lookup columns to compute…");
await wait(6000);
const refreshed = await employeeRow({
  ...context,
  employee: await erp.objects.employee.get(employee.id),
});
check(
  "department name lookup resolved",
  text(refreshed[F.employee.departmentName]) === "ZZ Smoke — Phòng thử nghiệm",
  refreshed[F.employee.departmentName],
);
check(
  "job title name lookup resolved",
  text(refreshed[F.employee.jobTitleName]) === "ZZ Smoke — Chuyên viên thử nghiệm",
  refreshed[F.employee.jobTitleName],
);
check("profile completion computed", profileCompletion(refreshed) > 0);

console.log("• Owned collections: create → list → update → delete");

const contact = await emergencyContacts.createRow(context, {
  fullName: "ZZ Smoke — Người thân",
  relationship: "Vợ/Chồng",
  phone: "0900000002",
  email: "",
  address: "Hà Nội",
  isPrimary: true,
});
let contactRows = await emergencyContacts.listRows(context);
check("emergency contact visible through incoming links", contactRows.some((row) => row.id === contact.id));
await emergencyContacts.updateRow(context, contact.id, {
  fullName: "ZZ Smoke — Người thân (đã sửa)",
  relationship: "Vợ/Chồng",
  phone: "0900000003",
  email: "",
  address: "Hà Nội",
  isPrimary: false,
});
contactRows = await emergencyContacts.listRows(context);
check(
  "emergency contact update persisted",
  contactRows.some((row) => text(row[F.emergencyContact.phone]) === "0900000003"),
);

const dependent = await dependents.createRow(context, {
  fullName: "ZZ Smoke — Con",
  relationship: "Con",
  birthDate: "2018-05-04",
  taxCode: "",
  idNumber: "",
  isDeduction: true,
  deductionFrom: "2024-01-01",
  deductionTo: "",
});
check("dependent created", (await dependents.listRows(context)).some((row) => row.id === dependent.id));

const qualification = await qualifications.createRow(context, {
  kind: "Bằng cấp",
  name: "ZZ Smoke — Cử nhân",
  institution: "Đại học Thử Nghiệm",
  major: "Công nghệ thông tin",
  grade: "Giỏi",
  issuedDate: "2016-06-30",
  expiredDate: "",
  note: "",
});
check(
  "qualification created",
  (await qualifications.listRows(context)).some((row) => row.id === qualification.id),
);

const history = await workHistory.createRow(context, {
  changeType: "Điều chuyển",
  departmentId: department.id,
  jobTitleId: jobTitle.id,
  organization: "",
  fromDate: "2023-01-01",
  toDate: "",
  decisionNumber: "QD-001",
  note: "",
});
check("work history relation ids returned", history.relations?.departmentId === department.id, history.relations);

await workHistory.updateRow(context, history.id, {
  changeType: "Bổ nhiệm",
  departmentId: "",
  jobTitleId: jobTitle.id,
  organization: "",
  fromDate: "2023-01-01",
  toDate: "2024-01-01",
  decisionNumber: "QD-002",
  note: "",
});
const historyRows = await workHistory.listRows(context);
const updatedHistory = historyRows.find((row) => row.id === history.id);
check("work history relation cleared", updatedHistory?.relations?.departmentId === null, updatedHistory?.relations);
check("work history relation kept", updatedHistory?.relations?.jobTitleId === jobTitle.id);

console.log("• Ownership guard");
const foreign = await erp.objects.emergencyContact.create({
  [F.emergencyContact.fullName]: "ZZ Smoke — Của người khác",
});
let guarded = false;
try {
  await emergencyContacts.updateRow(context, foreign.id, {
    fullName: "hijacked",
    relationship: "",
    phone: "0900000004",
    email: "",
    address: "",
    isPrimary: false,
  });
} catch (error) {
  guarded = (error as { status?: number }).status === 404;
}
check("record without an owner link is not editable", guarded);
check(
  "record without an owner link is not listed",
  !(await emergencyContacts.listRows(context)).some((row) => row.id === foreign.id),
);

console.log("• Asset assignment read path");
const asset = await erp.objects.asset.create({
  [F.asset.name]: "ZZ Smoke — Laptop",
  [F.asset.code]: "ZZ-LT-01",
  [F.asset.category]: "Laptop",
  [F.asset.status]: "Đang sử dụng",
});
const assignment = await erp.objects.assetAssignment.create({
  [F.assetAssignment.issuedDate]: "2025-01-15",
  [F.assetAssignment.handoverStatus]: "Đang sử dụng",
  [F.assetAssignment.quantity]: 1,
});
await setRelations(erp.objects.assetAssignment, assignment.id, {
  [F.assetAssignment.employee]: employee.id,
  [F.assetAssignment.asset]: asset.id,
});
await wait(6000);
const assignmentIds = await incomingRecordIds(
  erp.app,
  erp.objects.employee,
  employee.id,
  erp.objects.assetAssignment,
  F.assetAssignment.employee,
);
const assignmentRows = (await getRecords(erp.objects.assetAssignment, assignmentIds)).map((record) =>
  erp.objects.assetAssignment.rowFromRecord(record),
);
check("assignment found for employee", assignmentRows.some((row) => row.id === assignment.id));
check(
  "asset name lookup resolved on assignment",
  assignmentRows.some((row) => text(row[F.assetAssignment.assetName]) === "ZZ Smoke — Laptop"),
  assignmentRows.map((row) => row[F.assetAssignment.assetName]),
);

console.log("• Cleaning up smoke records…");
await emergencyContacts.removeRow(context, contact.id);
await dependents.removeRow(context, dependent.id);
await qualifications.removeRow(context, qualification.id);
await workHistory.removeRow(context, history.id);
await erp.objects.emergencyContact.delete(foreign.id);
await erp.objects.assetAssignment.delete(assignment.id);
await erp.objects.asset.delete(asset.id);
await erp.objects.employee.update(employee.id, writable({ [F.employee.phone]: null }));
await setRelations(erp.objects.employee, employee.id, {
  [F.employee.department]: null,
  [F.employee.jobTitle]: null,
});
await erp.objects.department.delete(department.id);
await erp.objects.jobTitle.delete(jobTitle.id);

check("collections empty again", (await emergencyContacts.listRows(context)).length === 0);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
