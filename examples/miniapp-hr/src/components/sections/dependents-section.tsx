"use client";

import { UsersIcon } from "lucide-react";
import { CollectionSection } from "@/components/common/collection-section";
import { display } from "@/components/common/detail-list";
import { type FormFieldConfig, toOptions } from "@/components/common/record-form";
import { type DependentInput, dependentSchema } from "@/lib/domain/schemas";
import { F, OPTIONS } from "@/lib/erp/schema";
import { bool, formatDate, formatRange, text } from "@/lib/format";

const FIELDS: FormFieldConfig[] = [
  { name: "fullName", label: "Họ và tên" },
  {
    name: "relationship",
    label: "Quan hệ",
    kind: "select",
    options: toOptions(OPTIONS.relationship),
  },
  { name: "birthDate", label: "Ngày sinh", kind: "date" },
  { name: "idNumber", label: "Số CCCD / Giấy khai sinh" },
  { name: "taxCode", label: "Mã số thuế người phụ thuộc" },
  {
    name: "isDeduction",
    label: "Đăng ký giảm trừ gia cảnh",
    kind: "checkbox",
    description: "Đánh dấu nếu người này đã được đăng ký giảm trừ khi tính thuế TNCN.",
  },
  { name: "deductionFrom", label: "Giảm trừ từ ngày", kind: "date" },
  { name: "deductionTo", label: "Giảm trừ đến ngày", kind: "date" },
];

const EMPTY: DependentInput = {
  fullName: "",
  relationship: "",
  birthDate: "",
  taxCode: "",
  idNumber: "",
  isDeduction: false,
  deductionFrom: "",
  deductionTo: "",
};

export function DependentsSection() {
  return (
    <CollectionSection<DependentInput>
      path="dependents"
      icon={UsersIcon}
      title="Người phụ thuộc"
      description="Danh sách người phụ thuộc dùng cho đăng ký giảm trừ gia cảnh và phúc lợi."
      addLabel="Thêm người phụ thuộc"
      formTitle="Người phụ thuộc"
      schema={dependentSchema}
      fields={FIELDS}
      emptyValues={EMPTY}
      emptyTitle="Chưa khai báo người phụ thuộc"
      emptyDescription="Khai báo con, bố mẹ hoặc người thân bạn đang trực tiếp nuôi dưỡng."
      toValues={(row) => ({
        fullName: text(row[F.dependent.fullName]),
        relationship: text(row[F.dependent.relationship]),
        birthDate: text(row[F.dependent.birthDate]),
        taxCode: text(row[F.dependent.taxCode]),
        idNumber: text(row[F.dependent.idNumber]),
        isDeduction: bool(row[F.dependent.isDeduction]),
        deductionFrom: text(row[F.dependent.deductionFrom]),
        deductionTo: text(row[F.dependent.deductionTo]),
      })}
      card={(row) => ({
        title: text(row[F.dependent.fullName]) || "Chưa đặt tên",
        subtitle: text(row[F.dependent.relationship]) || undefined,
        badges: bool(row[F.dependent.isDeduction])
          ? [{ label: "Đang giảm trừ", variant: "default" }]
          : [{ label: "Chưa đăng ký giảm trừ", variant: "outline" }],
        details: [
          { label: "Ngày sinh", value: display(formatDate(row[F.dependent.birthDate])) },
          { label: "Số CCCD / Khai sinh", value: display(row[F.dependent.idNumber]) },
          { label: "Mã số thuế", value: display(row[F.dependent.taxCode]) },
          {
            label: "Thời gian giảm trừ",
            value: display(
              formatRange(row[F.dependent.deductionFrom], row[F.dependent.deductionTo]),
            ),
          },
        ],
      })}
    />
  );
}
