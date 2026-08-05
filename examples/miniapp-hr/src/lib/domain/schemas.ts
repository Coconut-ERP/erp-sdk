import { z } from "zod";

const text = (max = 255) => z.string().trim().max(max);
const requiredText = (label: string, max = 255) =>
  z.string().trim().min(1, `${label} không được để trống`).max(max);

const date = z
  .string()
  .trim()
  .refine((value) => value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value), "Ngày không hợp lệ");

const email = z
  .string()
  .trim()
  .refine((value) => value === "" || z.email().safeParse(value).success, "Email không hợp lệ");

/**
 * Values of `single_select` columns stay plain strings here: the ERP validates
 * them against the option list it actually stores, so a workspace that added an
 * option keeps working without redeploying the app.
 */
const option = () => z.string().trim().max(120);

const recordId = z.union([z.uuid(), z.literal("")]);

export const profileSchema = z.object({
  fullName: requiredText("Họ và tên"),
  code: text(50),
  workEmail: email,
  phone: text(30),
  birthDate: date,
  gender: option(),
  idNumber: text(30),
  idIssuedDate: date,
  idIssuedPlace: text(120),
  maritalStatus: option(),
  permanentAddress: text(500),
  currentAddress: text(500),
  taxCode: text(30),
  socialInsuranceNumber: text(30),
  bankAccount: text(40),
  bankName: text(120),
  joinDate: date,
  contractType: option(),
  workStatus: option(),
  departmentId: recordId,
  jobTitleId: recordId,
  managerId: recordId,
});

export const emergencyContactSchema = z.object({
  fullName: requiredText("Họ và tên"),
  relationship: option(),
  phone: requiredText("Số điện thoại", 30),
  email,
  address: text(500),
  isPrimary: z.boolean(),
});

export const dependentSchema = z.object({
  fullName: requiredText("Họ và tên"),
  relationship: option(),
  birthDate: date,
  taxCode: text(30),
  idNumber: text(30),
  isDeduction: z.boolean(),
  deductionFrom: date,
  deductionTo: date,
});

export const qualificationSchema = z.object({
  kind: option(),
  name: requiredText("Tên văn bằng"),
  institution: text(200),
  major: text(200),
  grade: option(),
  issuedDate: date,
  expiredDate: date,
  note: text(1000),
});

export const workHistorySchema = z.object({
  changeType: option(),
  departmentId: recordId,
  jobTitleId: recordId,
  organization: text(200),
  fromDate: date,
  toDate: date,
  decisionNumber: text(60),
  note: text(1000),
});

export type ProfileInput = z.infer<typeof profileSchema>;
export type EmergencyContactInput = z.infer<typeof emergencyContactSchema>;
export type DependentInput = z.infer<typeof dependentSchema>;
export type QualificationInput = z.infer<typeof qualificationSchema>;
export type WorkHistoryInput = z.infer<typeof workHistorySchema>;
