"use client";

import { PhoneCallIcon } from "lucide-react";
import { CollectionSection } from "@/components/common/collection-section";
import { display } from "@/components/common/detail-list";
import { type FormFieldConfig, toOptions } from "@/components/common/record-form";
import { type EmergencyContactInput, emergencyContactSchema } from "@/lib/domain/schemas";
import { F, OPTIONS } from "@/lib/erp/schema";
import { bool, text } from "@/lib/format";

const FIELDS: FormFieldConfig[] = [
  { name: "fullName", label: "Họ và tên", placeholder: "Nguyễn Văn A" },
  {
    name: "relationship",
    label: "Mối quan hệ",
    kind: "select",
    options: toOptions(OPTIONS.relationship),
  },
  { name: "phone", label: "Số điện thoại", kind: "tel", placeholder: "0912345678" },
  { name: "email", label: "Email", kind: "email" },
  { name: "address", label: "Địa chỉ", kind: "textarea" },
  {
    name: "isPrimary",
    label: "Đây là liên hệ chính",
    kind: "checkbox",
    description: "Người được liên hệ đầu tiên trong trường hợp khẩn cấp.",
  },
];

const EMPTY: EmergencyContactInput = {
  fullName: "",
  relationship: "",
  phone: "",
  email: "",
  address: "",
  isPrimary: false,
};

export function EmergencyContactsSection() {
  return (
    <CollectionSection<EmergencyContactInput>
      path="emergency-contacts"
      icon={PhoneCallIcon}
      title="Liên hệ khẩn cấp"
      description="Người công ty sẽ liên hệ khi có sự cố xảy ra với bạn. Hãy giữ số điện thoại luôn đúng."
      addLabel="Thêm liên hệ"
      formTitle="Liên hệ khẩn cấp"
      schema={emergencyContactSchema}
      fields={FIELDS}
      emptyValues={EMPTY}
      emptyTitle="Chưa có liên hệ khẩn cấp"
      emptyDescription="Thêm ít nhất một người thân để công ty có thể liên hệ khi cần."
      toValues={(row) => ({
        fullName: text(row[F.emergencyContact.fullName]),
        relationship: text(row[F.emergencyContact.relationship]),
        phone: text(row[F.emergencyContact.phone]),
        email: text(row[F.emergencyContact.email]),
        address: text(row[F.emergencyContact.address]),
        isPrimary: bool(row[F.emergencyContact.isPrimary]),
      })}
      card={(row) => ({
        title: text(row[F.emergencyContact.fullName]) || "Chưa đặt tên",
        subtitle: text(row[F.emergencyContact.relationship]) || undefined,
        badges: bool(row[F.emergencyContact.isPrimary])
          ? [{ label: "Liên hệ chính", variant: "default" }]
          : undefined,
        details: [
          { label: "Số điện thoại", value: display(row[F.emergencyContact.phone]) },
          { label: "Email", value: display(row[F.emergencyContact.email]) },
          { label: "Địa chỉ", value: display(row[F.emergencyContact.address]) },
        ],
      })}
    />
  );
}
