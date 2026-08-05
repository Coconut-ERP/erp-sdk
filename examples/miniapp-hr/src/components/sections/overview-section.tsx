"use client";

import {
  ArrowRightIcon,
  BookOpenTextIcon,
  BriefcaseBusinessIcon,
  CircleAlertIcon,
  GraduationCapIcon,
  type LucideIcon,
  PackageIcon,
  PhoneCallIcon,
  UsersIcon,
} from "lucide-react";
import { CompletionBar } from "@/components/common/completion-bar";
import { display } from "@/components/common/detail-list";
import { ErrorState, LoadingRows } from "@/components/common/states";
import type { SectionId } from "@/components/navigation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useAssets, useCollection, useMe, usePolicies } from "@/hooks/use-hr";
import { F } from "@/lib/erp/schema";
import { formatDate, initials, text } from "@/lib/format";

interface StatCard {
  id: SectionId;
  label: string;
  icon: LucideIcon;
  count: number | undefined;
  hint: string;
}

export function OverviewSection({ onNavigate }: { onNavigate: (section: SectionId) => void }) {
  const me = useMe();
  const contacts = useCollection("emergency-contacts");
  const dependents = useCollection("dependents");
  const qualifications = useCollection("qualifications");
  const workHistory = useCollection("work-history");
  const assets = useAssets();
  const policies = usePolicies();

  if (me.isPending) return <LoadingRows rows={4} />;
  if (me.isError) return <ErrorState error={me.error} onRetry={() => me.refetch()} />;

  const employee = me.data.employee;
  const name = text(employee[F.employee.fullName]) || me.data.user.displayName;

  const stats: StatCard[] = [
    {
      id: "emergency-contacts",
      label: "Liên hệ khẩn cấp",
      icon: PhoneCallIcon,
      count: contacts.data?.items.length,
      hint: "người thân đã khai báo",
    },
    {
      id: "dependents",
      label: "Người phụ thuộc",
      icon: UsersIcon,
      count: dependents.data?.items.length,
      hint: "hồ sơ giảm trừ",
    },
    {
      id: "qualifications",
      label: "Trình độ & bằng cấp",
      icon: GraduationCapIcon,
      count: qualifications.data?.items.length,
      hint: "văn bằng, chứng chỉ",
    },
    {
      id: "work-history",
      label: "Quá trình công tác",
      icon: BriefcaseBusinessIcon,
      count: workHistory.data?.items.length,
      hint: "giai đoạn công tác",
    },
    {
      id: "assets",
      label: "Tài sản đang giữ",
      icon: PackageIcon,
      count: assets.data?.assignments.length,
      hint: "phiếu cấp phát",
    },
  ];

  const todos = [
    contacts.data?.items.length === 0
      ? { label: "Thêm liên hệ khẩn cấp", section: "emergency-contacts" as SectionId }
      : null,
    text(employee[F.employee.phone]) === ""
      ? { label: "Cập nhật số điện thoại", section: "profile" as SectionId }
      : null,
    text(employee[F.employee.idNumber]) === ""
      ? { label: "Cập nhật số CCCD", section: "profile" as SectionId }
      : null,
    employee.relations?.departmentId
      ? null
      : { label: "Chọn phòng ban đang làm việc", section: "profile" as SectionId },
    text(employee[F.employee.bankAccount]) === ""
      ? { label: "Bổ sung tài khoản ngân hàng nhận lương", section: "profile" as SectionId }
      : null,
  ].filter((todo) => todo !== null);

  const latestPolicies = (policies.data?.items ?? []).slice(0, 3);

  return (
    <section className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Avatar className="size-14">
              <AvatarFallback className="text-base">{initials(name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 space-y-1">
              <CardTitle className="text-xl">Xin chào, {name}</CardTitle>
              <CardDescription>
                {[
                  text(employee[F.employee.jobTitleName]),
                  text(employee[F.employee.departmentName]),
                ]
                  .filter(Boolean)
                  .join(" · ") || "Hãy hoàn thiện hồ sơ để đồng nghiệp biết bạn làm ở đâu"}
              </CardDescription>
              <div className="flex flex-wrap gap-2 pt-1">
                {text(employee[F.employee.code]) ? (
                  <Badge variant="outline">Mã NV: {text(employee[F.employee.code])}</Badge>
                ) : null}
                {text(employee[F.employee.workStatus]) ? (
                  <Badge variant="secondary">{text(employee[F.employee.workStatus])}</Badge>
                ) : null}
                {text(employee[F.employee.joinDate]) ? (
                  <Badge variant="outline">
                    Vào công ty {formatDate(employee[F.employee.joinDate])}
                  </Badge>
                ) : null}
              </div>
            </div>
            <Button variant="outline" onClick={() => onNavigate("profile")}>
              Cập nhật hồ sơ
              <ArrowRightIcon />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <Separator />
          <div className="pt-2">
            <p className="pb-2 text-muted-foreground text-sm">Mức độ hoàn thiện hồ sơ</p>
            <CompletionBar value={me.data.profileCompletion} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-muted-foreground text-sm font-medium">
                <stat.icon className="size-4" />
                {stat.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-end justify-between gap-3">
              <div>
                <p className="font-semibold text-3xl tabular-nums">{stat.count ?? "—"}</p>
                <p className="text-muted-foreground text-xs">{stat.hint}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => onNavigate(stat.id)}>
                Xem
                <ArrowRightIcon />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Việc cần làm</CardTitle>
            <CardDescription>
              Những thông tin còn thiếu để hồ sơ của bạn sẵn sàng cho các thủ tục nhân sự.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {todos.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Hồ sơ của bạn đã đầy đủ những mục quan trọng. Cảm ơn bạn!
              </p>
            ) : (
              todos.map((todo) => (
                <button
                  key={todo.label}
                  type="button"
                  onClick={() => onNavigate(todo.section)}
                  className="flex w-full items-center gap-3 rounded-lg border border-dashed px-3 py-2.5 text-left text-sm transition-colors hover:border-primary/40 hover:bg-accent"
                >
                  <CircleAlertIcon className="size-4 shrink-0 text-warning" />
                  <span className="flex-1">{todo.label}</span>
                  <ArrowRightIcon className="size-4 text-muted-foreground" />
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Văn bản mới nhất</CardTitle>
            <CardDescription>Quy định và chính sách vừa được ban hành.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {latestPolicies.length === 0 ? (
              <p className="text-muted-foreground text-sm">Chưa có văn bản nào được ban hành.</p>
            ) : (
              latestPolicies.map((policy) => (
                <div key={policy.id} className="space-y-1">
                  <p className="font-medium text-sm">{display(policy[F.policy.title])}</p>
                  <p className="text-muted-foreground text-xs">
                    {[text(policy[F.policy.kind]), formatDate(policy[F.policy.effectiveDate])]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </p>
                </div>
              ))
            )}
            <Button variant="ghost" size="sm" onClick={() => onNavigate("policies")}>
              <BookOpenTextIcon />
              Xem tất cả văn bản
            </Button>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
