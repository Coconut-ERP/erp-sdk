"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { IdCardIcon, SaveIcon } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { CompletionBar } from "@/components/common/completion-bar";
import {
  type FormFieldConfig,
  FormFields,
  type SelectOption,
  toOptions,
} from "@/components/common/record-form";
import { SectionHeader } from "@/components/common/section-header";
import { ErrorState, LoadingRows } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useMe, useReferences, useSaveProfile } from "@/hooks/use-hr";
import { type ProfileInput, profileSchema } from "@/lib/domain/schemas";
import type { RecordRow } from "@/lib/domain/types";
import { F, OPTIONS } from "@/lib/erp/schema";
import { text } from "@/lib/format";

const EMPTY: ProfileInput = {
  fullName: "",
  code: "",
  workEmail: "",
  phone: "",
  birthDate: "",
  gender: "",
  idNumber: "",
  idIssuedDate: "",
  idIssuedPlace: "",
  maritalStatus: "",
  permanentAddress: "",
  currentAddress: "",
  taxCode: "",
  socialInsuranceNumber: "",
  bankAccount: "",
  bankName: "",
  joinDate: "",
  contractType: "",
  workStatus: "",
  departmentId: "",
  jobTitleId: "",
  managerId: "",
};

function toValues(employee: RecordRow): ProfileInput {
  return {
    fullName: text(employee[F.employee.fullName]),
    code: text(employee[F.employee.code]),
    workEmail: text(employee[F.employee.workEmail]),
    phone: text(employee[F.employee.phone]),
    birthDate: text(employee[F.employee.birthDate]),
    gender: text(employee[F.employee.gender]),
    idNumber: text(employee[F.employee.idNumber]),
    idIssuedDate: text(employee[F.employee.idIssuedDate]),
    idIssuedPlace: text(employee[F.employee.idIssuedPlace]),
    maritalStatus: text(employee[F.employee.maritalStatus]),
    permanentAddress: text(employee[F.employee.permanentAddress]),
    currentAddress: text(employee[F.employee.currentAddress]),
    taxCode: text(employee[F.employee.taxCode]),
    socialInsuranceNumber: text(employee[F.employee.socialInsuranceNumber]),
    bankAccount: text(employee[F.employee.bankAccount]),
    bankName: text(employee[F.employee.bankName]),
    joinDate: text(employee[F.employee.joinDate]),
    contractType: text(employee[F.employee.contractType]),
    workStatus: text(employee[F.employee.workStatus]),
    departmentId: text(employee.relations?.departmentId),
    jobTitleId: text(employee.relations?.jobTitleId),
    managerId: text(employee.relations?.managerId),
  };
}

const PERSONAL_FIELDS: FormFieldConfig[] = [
  { name: "fullName", label: "Họ và tên" },
  { name: "birthDate", label: "Ngày sinh", kind: "date" },
  { name: "gender", label: "Giới tính", kind: "select", options: toOptions(OPTIONS.gender) },
  {
    name: "maritalStatus",
    label: "Tình trạng hôn nhân",
    kind: "select",
    options: toOptions(OPTIONS.maritalStatus),
  },
  { name: "idNumber", label: "Số CCCD" },
  { name: "idIssuedDate", label: "Ngày cấp", kind: "date" },
  { name: "idIssuedPlace", label: "Nơi cấp", colSpan: 2 },
  { name: "permanentAddress", label: "Địa chỉ thường trú", kind: "textarea" },
  { name: "currentAddress", label: "Địa chỉ hiện tại", kind: "textarea" },
];

const CONTACT_FIELDS: FormFieldConfig[] = [
  { name: "workEmail", label: "Email công việc", kind: "email" },
  { name: "phone", label: "Số điện thoại", kind: "tel" },
];

const PAYROLL_FIELDS: FormFieldConfig[] = [
  { name: "taxCode", label: "Mã số thuế cá nhân" },
  { name: "socialInsuranceNumber", label: "Số sổ BHXH" },
  { name: "bankName", label: "Ngân hàng" },
  { name: "bankAccount", label: "Số tài khoản" },
];

export function ProfileSection() {
  const me = useMe();
  const references = useReferences();
  const save = useSaveProfile();

  const form = useForm<ProfileInput>({
    resolver: zodResolver(profileSchema),
    defaultValues: EMPTY,
  });

  const employee = me.data?.employee;

  useEffect(() => {
    if (employee) form.reset(toValues(employee));
  }, [employee, form]);

  const employmentFields = useMemo<FormFieldConfig[]>(() => {
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
    const colleagues: SelectOption[] = (references.data?.colleagues ?? []).map((option) => ({
      value: option.id,
      label: option.label,
      hint: option.hint,
    }));

    return [
      { name: "code", label: "Mã nhân viên" },
      { name: "joinDate", label: "Ngày vào công ty", kind: "date" },
      { name: "departmentId", label: "Phòng ban", kind: "select", options: departments },
      { name: "jobTitleId", label: "Chức danh", kind: "select", options: jobTitles },
      {
        name: "managerId",
        label: "Quản lý trực tiếp",
        kind: "select",
        options: colleagues,
        emptyLabel: "Chưa có quản lý",
      },
      {
        name: "contractType",
        label: "Loại hợp đồng",
        kind: "select",
        options: toOptions(OPTIONS.contractType),
      },
      {
        name: "workStatus",
        label: "Trạng thái làm việc",
        kind: "select",
        options: toOptions(OPTIONS.workStatus),
      },
    ];
  }, [references.data]);

  const submit = form.handleSubmit((values) => save.mutateAsync(values));

  if (me.isPending) return <LoadingRows rows={4} />;
  if (me.isError) return <ErrorState error={me.error} onRetry={() => me.refetch()} />;

  return (
    <section className="space-y-6">
      <SectionHeader
        icon={IdCardIcon}
        title="Hồ sơ của tôi"
        description="Thông tin này được lưu thẳng vào bảng Nhân sự của workspace. Bạn chỉ sửa được hồ sơ của chính mình."
        action={
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? <Spinner /> : <SaveIcon />}
            Lưu thay đổi
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Mức độ hoàn thiện hồ sơ</CardTitle>
          <CardDescription>
            Hồ sơ càng đầy đủ, các thủ tục nhân sự của bạn càng được xử lý nhanh.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CompletionBar value={me.data?.profileCompletion ?? 0} />
        </CardContent>
      </Card>

      <form onSubmit={submit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Thông tin cá nhân</CardTitle>
            <CardDescription>Thông tin định danh theo giấy tờ tuỳ thân.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormFields form={form} fields={PERSONAL_FIELDS} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Liên hệ</CardTitle>
            <CardDescription>Cách công ty và đồng nghiệp liên hệ với bạn.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormFields form={form} fields={CONTACT_FIELDS} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Thông tin công việc</CardTitle>
            <CardDescription>
              Phòng ban, chức danh và quản lý được liên kết tới đúng bản ghi trong workspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormFields form={form} fields={employmentFields} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Thuế, bảo hiểm & ngân hàng</CardTitle>
            <CardDescription>Dùng cho tính lương, BHXH và quyết toán thuế.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormFields form={form} fields={PAYROLL_FIELDS} />
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? <Spinner /> : <SaveIcon />}
            Lưu thay đổi
          </Button>
        </div>
      </form>
    </section>
  );
}
