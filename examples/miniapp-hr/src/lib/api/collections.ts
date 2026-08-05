import {
  dependentSchema,
  emergencyContactSchema,
  qualificationSchema,
  workHistorySchema,
} from "@/lib/domain/schemas";
import { F } from "@/lib/erp/schema";
import { ownedCollection } from "./collection";

export const emergencyContacts = ownedCollection({
  object: "emergencyContact",
  ownerField: F.emergencyContact.employee,
  schema: emergencyContactSchema,
  sort: { column: F.emergencyContact.fullName, direction: "asc" },
  toData: (input) => ({
    [F.emergencyContact.fullName]: input.fullName,
    [F.emergencyContact.relationship]: input.relationship,
    [F.emergencyContact.phone]: input.phone,
    [F.emergencyContact.email]: input.email,
    [F.emergencyContact.address]: input.address,
    [F.emergencyContact.isPrimary]: input.isPrimary,
  }),
});

export const dependents = ownedCollection({
  object: "dependent",
  ownerField: F.dependent.employee,
  schema: dependentSchema,
  sort: { column: F.dependent.fullName, direction: "asc" },
  toData: (input) => ({
    [F.dependent.fullName]: input.fullName,
    [F.dependent.relationship]: input.relationship,
    [F.dependent.birthDate]: input.birthDate,
    [F.dependent.taxCode]: input.taxCode,
    [F.dependent.idNumber]: input.idNumber,
    [F.dependent.isDeduction]: input.isDeduction,
    [F.dependent.deductionFrom]: input.deductionFrom,
    [F.dependent.deductionTo]: input.deductionTo,
  }),
});

export const qualifications = ownedCollection({
  object: "qualification",
  ownerField: F.qualification.employee,
  schema: qualificationSchema,
  sort: { column: F.qualification.issuedDate, direction: "desc" },
  toData: (input) => ({
    [F.qualification.kind]: input.kind,
    [F.qualification.name]: input.name,
    [F.qualification.institution]: input.institution,
    [F.qualification.major]: input.major,
    [F.qualification.grade]: input.grade,
    [F.qualification.issuedDate]: input.issuedDate,
    [F.qualification.expiredDate]: input.expiredDate,
    [F.qualification.note]: input.note,
  }),
});

export const workHistory = ownedCollection({
  object: "workHistory",
  ownerField: F.workHistory.employee,
  schema: workHistorySchema,
  sort: { column: F.workHistory.fromDate, direction: "desc" },
  relationFields: {
    departmentId: F.workHistory.department,
    jobTitleId: F.workHistory.jobTitle,
  },
  toData: (input) => ({
    [F.workHistory.changeType]: input.changeType,
    [F.workHistory.organization]: input.organization,
    [F.workHistory.fromDate]: input.fromDate,
    [F.workHistory.toDate]: input.toDate,
    [F.workHistory.decisionNumber]: input.decisionNumber,
    [F.workHistory.note]: input.note,
  }),
  toRelations: (input) => ({
    [F.workHistory.department]: input.departmentId || null,
    [F.workHistory.jobTitle]: input.jobTitleId || null,
  }),
});
