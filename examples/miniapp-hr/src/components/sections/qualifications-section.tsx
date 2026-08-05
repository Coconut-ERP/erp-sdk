"use client";

import { GraduationCapIcon } from "lucide-react";
import { CollectionSection } from "@/components/common/collection-section";
import { display } from "@/components/common/detail-list";
import { type FormFieldConfig, toOptions } from "@/components/common/record-form";
import { type QualificationInput, qualificationSchema } from "@/lib/domain/schemas";
import { F, OPTIONS } from "@/lib/erp/schema";
import { formatDate, text } from "@/lib/format";

const FIELDS: FormFieldConfig[] = [
  { name: "kind", label: "Loại", kind: "select", options: toOptions(OPTIONS.qualificationKind) },
  { name: "name", label: "Tên văn bằng / chứng chỉ", placeholder: "Cử nhân Công nghệ thông tin" },
  { name: "institution", label: "Nơi đào tạo / cấp" },
  { name: "major", label: "Chuyên ngành" },
  {
    name: "grade",
    label: "Xếp loại",
    kind: "select",
    options: toOptions(OPTIONS.qualificationGrade),
  },
  { name: "issuedDate", label: "Ngày cấp", kind: "date" },
  { name: "expiredDate", label: "Ngày hết hạn", kind: "date" },
  { name: "note", label: "Ghi chú", kind: "textarea" },
];

const EMPTY: QualificationInput = {
  kind: "",
  name: "",
  institution: "",
  major: "",
  grade: "",
  issuedDate: "",
  expiredDate: "",
  note: "",
};

function expiryBadge(value: unknown) {
  const raw = text(value);
  if (!raw) return undefined;
  const expired = new Date(raw).getTime() < Date.now();
  return [
    expired
      ? { label: "Đã hết hạn", variant: "destructive" as const }
      : { label: `Hiệu lực đến ${formatDate(raw)}`, variant: "outline" as const },
  ];
}

export function QualificationsSection() {
  return (
    <CollectionSection<QualificationInput>
      path="qualifications"
      icon={GraduationCapIcon}
      title="Trình độ & bằng cấp"
      description="Bằng cấp, chứng chỉ và các khoá đào tạo bạn đã hoàn thành."
      addLabel="Thêm văn bằng"
      formTitle="Văn bằng / chứng chỉ"
      schema={qualificationSchema}
      fields={FIELDS}
      emptyValues={EMPTY}
      emptyTitle="Chưa có văn bằng nào"
      emptyDescription="Thêm bằng cấp hoặc chứng chỉ để hồ sơ năng lực của bạn đầy đủ hơn."
      toValues={(row) => ({
        kind: text(row[F.qualification.kind]),
        name: text(row[F.qualification.name]),
        institution: text(row[F.qualification.institution]),
        major: text(row[F.qualification.major]),
        grade: text(row[F.qualification.grade]),
        issuedDate: text(row[F.qualification.issuedDate]),
        expiredDate: text(row[F.qualification.expiredDate]),
        note: text(row[F.qualification.note]),
      })}
      card={(row) => ({
        title: text(row[F.qualification.name]) || "Chưa đặt tên",
        subtitle:
          [text(row[F.qualification.institution]), text(row[F.qualification.major])]
            .filter(Boolean)
            .join(" · ") || undefined,
        badges: [
          ...(text(row[F.qualification.kind])
            ? [{ label: text(row[F.qualification.kind]), variant: "secondary" as const }]
            : []),
          ...(expiryBadge(row[F.qualification.expiredDate]) ?? []),
        ],
        details: [
          { label: "Xếp loại", value: display(row[F.qualification.grade]) },
          { label: "Ngày cấp", value: display(formatDate(row[F.qualification.issuedDate])) },
          { label: "Ghi chú", value: display(row[F.qualification.note]) },
        ],
      })}
    />
  );
}
