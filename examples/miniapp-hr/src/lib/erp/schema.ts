import { defineSchema, type MiniAppSchema, type SchemaFieldSpec } from "erp-sdk";

export const OBJECTS = {
  department: "Phòng ban",
  jobTitle: "Chức danh",
  employee: "Nhân sự",
  emergencyContact: "Liên hệ khẩn cấp",
  dependent: "Người phụ thuộc",
  qualification: "Trình độ & bằng cấp",
  workHistory: "Quá trình công tác",
  asset: "Danh mục tài sản",
  assetAssignment: "Cấp phát tài sản",
  policy: "Quy định & chính sách",
} as const;

export type ObjectKey = keyof typeof OBJECTS;

export const OBJECT_KEYS = Object.keys(OBJECTS) as ObjectKey[];

export const F = {
  department: {
    name: "Tên phòng ban",
    code: "Mã phòng ban",
    description: "Mô tả",
    parent: "Phòng ban cha",
    parentName: "Tên phòng ban cha",
  },
  jobTitle: {
    name: "Tên chức danh",
    code: "Mã chức danh",
    level: "Cấp bậc",
    description: "Mô tả",
  },
  employee: {
    code: "Mã nhân viên",
    fullName: "Họ và tên",
    account: "Tài khoản",
    workEmail: "Email công việc",
    phone: "Số điện thoại",
    birthDate: "Ngày sinh",
    gender: "Giới tính",
    idNumber: "Số CCCD",
    idIssuedDate: "Ngày cấp CCCD",
    idIssuedPlace: "Nơi cấp CCCD",
    maritalStatus: "Tình trạng hôn nhân",
    permanentAddress: "Địa chỉ thường trú",
    currentAddress: "Địa chỉ hiện tại",
    taxCode: "Mã số thuế",
    socialInsuranceNumber: "Số sổ BHXH",
    bankAccount: "Số tài khoản ngân hàng",
    bankName: "Ngân hàng",
    joinDate: "Ngày vào công ty",
    contractType: "Loại hợp đồng",
    workStatus: "Trạng thái làm việc",
    department: "Phòng ban",
    jobTitle: "Chức danh",
    manager: "Quản lý trực tiếp",
    departmentName: "Tên phòng ban",
    jobTitleName: "Tên chức danh",
    managerName: "Tên quản lý",
  },
  emergencyContact: {
    employee: "Nhân sự",
    fullName: "Họ và tên",
    relationship: "Mối quan hệ",
    phone: "Số điện thoại",
    email: "Email",
    address: "Địa chỉ",
    isPrimary: "Liên hệ chính",
  },
  dependent: {
    employee: "Nhân sự",
    fullName: "Họ và tên",
    relationship: "Quan hệ",
    birthDate: "Ngày sinh",
    taxCode: "Mã số thuế",
    idNumber: "Số CCCD/Giấy khai sinh",
    isDeduction: "Đăng ký giảm trừ",
    deductionFrom: "Giảm trừ từ ngày",
    deductionTo: "Giảm trừ đến ngày",
  },
  qualification: {
    employee: "Nhân sự",
    kind: "Loại",
    name: "Tên văn bằng",
    institution: "Nơi đào tạo / cấp",
    major: "Chuyên ngành",
    grade: "Xếp loại",
    issuedDate: "Ngày cấp",
    expiredDate: "Ngày hết hạn",
    note: "Ghi chú",
  },
  workHistory: {
    employee: "Nhân sự",
    department: "Phòng ban",
    jobTitle: "Chức danh",
    organization: "Tổ chức bên ngoài",
    changeType: "Hình thức",
    fromDate: "Từ ngày",
    toDate: "Đến ngày",
    decisionNumber: "Số quyết định",
    note: "Ghi chú",
    departmentName: "Tên phòng ban",
    jobTitleName: "Tên chức danh",
  },
  asset: {
    code: "Mã tài sản",
    name: "Tên tài sản",
    category: "Loại tài sản",
    unit: "Đơn vị tính",
    serialNumber: "Số serial",
    originalCost: "Nguyên giá",
    status: "Tình trạng",
    note: "Ghi chú",
  },
  assetAssignment: {
    employee: "Nhân sự",
    asset: "Tài sản",
    quantity: "Số lượng",
    issuedDate: "Ngày cấp",
    returnedDate: "Ngày thu hồi",
    handoverStatus: "Tình trạng bàn giao",
    note: "Ghi chú",
    assetName: "Tên tài sản",
    assetCode: "Mã tài sản",
  },
  policy: {
    title: "Tiêu đề",
    code: "Mã văn bản",
    kind: "Loại văn bản",
    summary: "Tóm tắt",
    content: "Nội dung",
    issuedDate: "Ngày ban hành",
    effectiveDate: "Ngày hiệu lực",
    documentUrl: "Đường dẫn tài liệu",
    status: "Trạng thái",
    department: "Phòng ban áp dụng",
    departmentName: "Tên phòng ban áp dụng",
  },
} as const;

export const OPTIONS = {
  jobLevel: ["Nhân viên", "Chuyên viên", "Trưởng nhóm", "Quản lý", "Giám đốc"],
  gender: ["Nam", "Nữ", "Khác"],
  maritalStatus: ["Độc thân", "Đã kết hôn", "Khác"],
  contractType: [
    "Thử việc",
    "Xác định thời hạn",
    "Không xác định thời hạn",
    "Thời vụ",
    "Cộng tác viên",
  ],
  workStatus: ["Đang làm việc", "Nghỉ thai sản", "Tạm hoãn hợp đồng", "Đã nghỉ việc"],
  relationship: ["Bố", "Mẹ", "Vợ/Chồng", "Con", "Anh/Chị/Em", "Khác"],
  qualificationKind: ["Bằng cấp", "Chứng chỉ", "Khoá đào tạo"],
  qualificationGrade: ["Xuất sắc", "Giỏi", "Khá", "Trung bình", "Không xếp loại"],
  changeType: ["Tuyển mới", "Điều chuyển", "Bổ nhiệm", "Thăng chức", "Nghỉ việc", "Bên ngoài"],
  assetCategory: [
    "Laptop",
    "Màn hình",
    "Điện thoại",
    "Thiết bị văn phòng",
    "Đồng phục",
    "Phương tiện",
    "Khác",
  ],
  assetStatus: ["Sẵn sàng", "Đang sử dụng", "Bảo trì", "Thanh lý"],
  handoverStatus: ["Đang sử dụng", "Đã thu hồi", "Mất/Hỏng"],
  policyKind: ["Quy định", "Chính sách", "Quy trình", "Biểu mẫu", "Thông báo"],
  policyStatus: ["Hiệu lực", "Dự thảo", "Hết hiệu lực"],
} as const;

const select = (options: readonly string[]): SchemaFieldSpec["config"] => ({
  source: "static",
  options: [...options],
});

/**
 * Scalar fields carry no dependency on another table, so they are listed first
 * in the declaration; relations follow, and lookups cannot be declared at all.
 */
export const SCALAR_FIELDS: Record<ObjectKey, SchemaFieldSpec[]> = {
  department: [
    { name: F.department.name, type: "text" },
    { name: F.department.code, type: "text" },
    { name: F.department.description, type: "long_text" },
  ],
  jobTitle: [
    { name: F.jobTitle.name, type: "text" },
    { name: F.jobTitle.code, type: "text" },
    { name: F.jobTitle.level, type: "single_select", config: select(OPTIONS.jobLevel) },
    { name: F.jobTitle.description, type: "long_text" },
  ],
  employee: [
    { name: F.employee.code, type: "text" },
    { name: F.employee.fullName, type: "text" },
    {
      name: F.employee.account,
      type: "single_select",
      config: { source: "workspace_users" },
    },
    { name: F.employee.workEmail, type: "email" },
    { name: F.employee.phone, type: "phone" },
    { name: F.employee.birthDate, type: "date" },
    { name: F.employee.gender, type: "single_select", config: select(OPTIONS.gender) },
    { name: F.employee.idNumber, type: "text" },
    { name: F.employee.idIssuedDate, type: "date" },
    { name: F.employee.idIssuedPlace, type: "text" },
    {
      name: F.employee.maritalStatus,
      type: "single_select",
      config: select(OPTIONS.maritalStatus),
    },
    { name: F.employee.permanentAddress, type: "long_text" },
    { name: F.employee.currentAddress, type: "long_text" },
    { name: F.employee.taxCode, type: "text" },
    { name: F.employee.socialInsuranceNumber, type: "text" },
    { name: F.employee.bankAccount, type: "text" },
    { name: F.employee.bankName, type: "text" },
    { name: F.employee.joinDate, type: "date" },
    {
      name: F.employee.contractType,
      type: "single_select",
      config: select(OPTIONS.contractType),
    },
    { name: F.employee.workStatus, type: "single_select", config: select(OPTIONS.workStatus) },
  ],
  emergencyContact: [
    { name: F.emergencyContact.fullName, type: "text" },
    {
      name: F.emergencyContact.relationship,
      type: "single_select",
      config: select(OPTIONS.relationship),
    },
    { name: F.emergencyContact.phone, type: "phone" },
    { name: F.emergencyContact.email, type: "email" },
    { name: F.emergencyContact.address, type: "long_text" },
    { name: F.emergencyContact.isPrimary, type: "checkbox" },
  ],
  dependent: [
    { name: F.dependent.fullName, type: "text" },
    {
      name: F.dependent.relationship,
      type: "single_select",
      config: select(OPTIONS.relationship),
    },
    { name: F.dependent.birthDate, type: "date" },
    { name: F.dependent.taxCode, type: "text" },
    { name: F.dependent.idNumber, type: "text" },
    { name: F.dependent.isDeduction, type: "checkbox" },
    { name: F.dependent.deductionFrom, type: "date" },
    { name: F.dependent.deductionTo, type: "date" },
  ],
  qualification: [
    {
      name: F.qualification.kind,
      type: "single_select",
      config: select(OPTIONS.qualificationKind),
    },
    { name: F.qualification.name, type: "text" },
    { name: F.qualification.institution, type: "text" },
    { name: F.qualification.major, type: "text" },
    {
      name: F.qualification.grade,
      type: "single_select",
      config: select(OPTIONS.qualificationGrade),
    },
    { name: F.qualification.issuedDate, type: "date" },
    { name: F.qualification.expiredDate, type: "date" },
    { name: F.qualification.note, type: "long_text" },
  ],
  workHistory: [
    { name: F.workHistory.organization, type: "text" },
    {
      name: F.workHistory.changeType,
      type: "single_select",
      config: select(OPTIONS.changeType),
    },
    { name: F.workHistory.fromDate, type: "date" },
    { name: F.workHistory.toDate, type: "date" },
    { name: F.workHistory.decisionNumber, type: "text" },
    { name: F.workHistory.note, type: "long_text" },
  ],
  asset: [
    { name: F.asset.code, type: "text" },
    { name: F.asset.name, type: "text" },
    { name: F.asset.category, type: "single_select", config: select(OPTIONS.assetCategory) },
    { name: F.asset.unit, type: "text" },
    { name: F.asset.serialNumber, type: "text" },
    { name: F.asset.originalCost, type: "currency" },
    { name: F.asset.status, type: "single_select", config: select(OPTIONS.assetStatus) },
    { name: F.asset.note, type: "long_text" },
  ],
  assetAssignment: [
    { name: F.assetAssignment.quantity, type: "number" },
    { name: F.assetAssignment.issuedDate, type: "date" },
    { name: F.assetAssignment.returnedDate, type: "date" },
    {
      name: F.assetAssignment.handoverStatus,
      type: "single_select",
      config: select(OPTIONS.handoverStatus),
    },
    { name: F.assetAssignment.note, type: "long_text" },
  ],
  policy: [
    { name: F.policy.title, type: "text" },
    { name: F.policy.code, type: "text" },
    { name: F.policy.kind, type: "single_select", config: select(OPTIONS.policyKind) },
    { name: F.policy.summary, type: "long_text" },
    { name: F.policy.content, type: "long_text" },
    { name: F.policy.issuedDate, type: "date" },
    { name: F.policy.effectiveDate, type: "date" },
    { name: F.policy.documentUrl, type: "url" },
    { name: F.policy.status, type: "single_select", config: select(OPTIONS.policyStatus) },
  ],
};

export interface RelationSpec {
  object: ObjectKey;
  field: string;
  target: ObjectKey;
}

/** Every reference between two tables is a real `relation` field, never a copied name. */
export const RELATION_FIELDS: RelationSpec[] = [
  { object: "department", field: F.department.parent, target: "department" },
  { object: "employee", field: F.employee.department, target: "department" },
  { object: "employee", field: F.employee.jobTitle, target: "jobTitle" },
  { object: "employee", field: F.employee.manager, target: "employee" },
  { object: "emergencyContact", field: F.emergencyContact.employee, target: "employee" },
  { object: "dependent", field: F.dependent.employee, target: "employee" },
  { object: "qualification", field: F.qualification.employee, target: "employee" },
  { object: "workHistory", field: F.workHistory.employee, target: "employee" },
  { object: "workHistory", field: F.workHistory.department, target: "department" },
  { object: "workHistory", field: F.workHistory.jobTitle, target: "jobTitle" },
  { object: "assetAssignment", field: F.assetAssignment.employee, target: "employee" },
  { object: "assetAssignment", field: F.assetAssignment.asset, target: "asset" },
  { object: "policy", field: F.policy.department, target: "department" },
];

export interface LookupSpec {
  object: ObjectKey;
  field: string;
  via: string;
  target: ObjectKey;
  targetField: string;
}

/**
 * Lookups mirror one column of the related record into `computedData`, so list
 * views render related names without one links request per row.
 */
export const LOOKUP_FIELDS: LookupSpec[] = [
  {
    object: "department",
    field: F.department.parentName,
    via: F.department.parent,
    target: "department",
    targetField: F.department.name,
  },
  {
    object: "employee",
    field: F.employee.departmentName,
    via: F.employee.department,
    target: "department",
    targetField: F.department.name,
  },
  {
    object: "employee",
    field: F.employee.jobTitleName,
    via: F.employee.jobTitle,
    target: "jobTitle",
    targetField: F.jobTitle.name,
  },
  {
    object: "employee",
    field: F.employee.managerName,
    via: F.employee.manager,
    target: "employee",
    targetField: F.employee.fullName,
  },
  {
    object: "workHistory",
    field: F.workHistory.departmentName,
    via: F.workHistory.department,
    target: "department",
    targetField: F.department.name,
  },
  {
    object: "workHistory",
    field: F.workHistory.jobTitleName,
    via: F.workHistory.jobTitle,
    target: "jobTitle",
    targetField: F.jobTitle.name,
  },
  {
    object: "assetAssignment",
    field: F.assetAssignment.assetName,
    via: F.assetAssignment.asset,
    target: "asset",
    targetField: F.asset.name,
  },
  {
    object: "assetAssignment",
    field: F.assetAssignment.assetCode,
    via: F.assetAssignment.asset,
    target: "asset",
    targetField: F.asset.code,
  },
  {
    object: "policy",
    field: F.policy.departmentName,
    via: F.policy.department,
    target: "department",
    targetField: F.department.name,
  },
];

/**
 * The declaration that ships as `schema.json` at the root of the source —
 * regenerate the file with `npm run schema` after touching anything above.
 *
 * A mini app cannot create tables: it asks for them, and whoever deploys it
 * reviews the request and applies it under their own permissions. Lookups are
 * missing on purpose — their config points at other fields by internal key, so
 * they cannot be declared and have to be added by hand in the workspace.
 */
export function declaration(): MiniAppSchema {
  return defineSchema({
    objects: OBJECT_KEYS.map((key, index) => ({
      name: OBJECTS[key],
      position: index,
      fields: [
        ...SCALAR_FIELDS[key],
        ...RELATION_FIELDS.filter((spec) => spec.object === key).map((spec) => ({
          name: spec.field,
          type: "relation",
          config: { targetObject: OBJECTS[spec.target] },
        })),
      ].map((field, position) => ({ ...field, position })),
    })),
  });
}
