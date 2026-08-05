"use client";

import { BriefcaseBusinessIcon } from "lucide-react";
import { useMemo } from "react";
import { CollectionSection } from "@/components/common/collection-section";
import { display } from "@/components/common/detail-list";
import {
  type FormFieldConfig,
  type SelectOption,
  toOptions,
} from "@/components/common/record-form";
import { useReferences } from "@/hooks/use-hr";
import { type WorkHistoryInput, workHistorySchema } from "@/lib/domain/schemas";
import { F, OPTIONS } from "@/lib/erp/schema";
import { formatDate, formatRange, text } from "@/lib/format";

const EMPTY: WorkHistoryInput = {
  changeType: "",
  departmentId: "",
  jobTitleId: "",
  organization: "",
  fromDate: "",
  toDate: "",
  decisionNumber: "",
  note: "",
};

export function WorkHistorySection() {
  const references = useReferences();

  const fields = useMemo<FormFieldConfig[]>(() => {
    const departments: SelectOption[] = (references.data?.departments ?? []).map((row) => ({
      value: row.id,
      label: text(row[F.department.name]) || "Chưa đặt tên",
      hint: text(row[F.department.code]) || undefined,
    }));
    const jobTitles: SelectOption[] = (references.data?.jobTitles ?? []).map((row) => ({
      value: row.id,
      label: text(row[F.jobTitle.name]) || "Chưa đặt tên",
      hint: text(row[F.jobTitle.level]) || undefined,
    }));

    return [
      {
        name: "changeType",
        label: "Hình thức",
        kind: "select",
        options: toOptions(OPTIONS.changeType),
      },
      {
        name: "departmentId",
        label: "Phòng ban",
        kind: "select",
        options: departments,
        emptyLabel: "Không thuộc phòng ban nội bộ",
      },
      {
        name: "jobTitleId",
        label: "Chức danh",
        kind: "select",
        options: jobTitles,
        emptyLabel: "Không có chức danh nội bộ",
      },
      {
        name: "organization",
        label: "Tổ chức bên ngoài",
        description: "Điền khi giai đoạn này diễn ra ở công ty khác.",
      },
      { name: "fromDate", label: "Từ ngày", kind: "date" },
      { name: "toDate", label: "Đến ngày", kind: "date" },
      { name: "decisionNumber", label: "Số quyết định" },
      { name: "note", label: "Ghi chú", kind: "textarea" },
    ];
  }, [references.data]);

  return (
    <CollectionSection<WorkHistoryInput>
      path="work-history"
      icon={BriefcaseBusinessIcon}
      title="Quá trình công tác"
      description="Các giai đoạn công tác của bạn — điều chuyển, bổ nhiệm nội bộ và cả kinh nghiệm trước đây."
      addLabel="Thêm giai đoạn"
      formTitle="Giai đoạn công tác"
      formDescription="Chọn phòng ban và chức danh có sẵn cho giai đoạn nội bộ, hoặc ghi tên tổ chức bên ngoài."
      schema={workHistorySchema}
      fields={fields}
      emptyValues={EMPTY}
      emptyTitle="Chưa có quá trình công tác"
      emptyDescription="Thêm giai đoạn đầu tiên để dựng lại lộ trình nghề nghiệp của bạn."
      toValues={(row) => ({
        changeType: text(row[F.workHistory.changeType]),
        departmentId: text(row.relations?.departmentId),
        jobTitleId: text(row.relations?.jobTitleId),
        organization: text(row[F.workHistory.organization]),
        fromDate: text(row[F.workHistory.fromDate]),
        toDate: text(row[F.workHistory.toDate]),
        decisionNumber: text(row[F.workHistory.decisionNumber]),
        note: text(row[F.workHistory.note]),
      })}
      card={(row) => ({
        title:
          text(row[F.workHistory.jobTitleName]) ||
          text(row[F.workHistory.changeType]) ||
          "Giai đoạn công tác",
        subtitle:
          text(row[F.workHistory.departmentName]) ||
          text(row[F.workHistory.organization]) ||
          undefined,
        badges: [
          ...(text(row[F.workHistory.changeType])
            ? [{ label: text(row[F.workHistory.changeType]), variant: "secondary" as const }]
            : []),
          ...(text(row[F.workHistory.toDate])
            ? []
            : [{ label: "Hiện tại", variant: "default" as const }]),
        ],
        details: [
          {
            label: "Thời gian",
            value: display(formatRange(row[F.workHistory.fromDate], row[F.workHistory.toDate])),
          },
          { label: "Số quyết định", value: display(row[F.workHistory.decisionNumber]) },
          { label: "Bắt đầu", value: display(formatDate(row[F.workHistory.fromDate])) },
          { label: "Ghi chú", value: display(row[F.workHistory.note]) },
        ],
      })}
    />
  );
}
