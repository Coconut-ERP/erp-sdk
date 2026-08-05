"use client";

import { ContactIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { display } from "@/components/common/detail-list";
import { SectionHeader } from "@/components/common/section-header";
import { EmptyState, ErrorState, LoadingRows } from "@/components/common/states";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDirectory } from "@/hooks/use-hr";
import { F } from "@/lib/erp/schema";
import { initials, text } from "@/lib/format";

const ALL_DEPARTMENTS = "__all__";

export function DirectorySection() {
  const query = useDirectory();
  const [keyword, setKeyword] = useState("");
  const [department, setDepartment] = useState(ALL_DEPARTMENTS);

  const rows = useMemo(() => query.data?.items ?? [], [query.data]);

  const departments = useMemo(() => {
    const names = new Set<string>();
    for (const row of rows) {
      const name = text(row[F.employee.departmentName]);
      if (name) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b, "vi"));
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesDepartment =
        department === ALL_DEPARTMENTS || text(row[F.employee.departmentName]) === department;
      if (!matchesDepartment) return false;
      if (!needle) return true;

      return [
        F.employee.fullName,
        F.employee.code,
        F.employee.workEmail,
        F.employee.phone,
        F.employee.jobTitleName,
        F.employee.departmentName,
      ].some((column) => text(row[column]).toLowerCase().includes(needle));
    });
  }, [rows, keyword, department]);

  return (
    <section className="space-y-6">
      <SectionHeader
        icon={ContactIcon}
        title="Danh bạ nhân sự"
        description="Tìm đồng nghiệp theo tên, phòng ban hoặc chức danh. Chỉ hiển thị thông tin công việc."
      />

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="Tìm theo tên, mã nhân viên, email…"
            className="pl-9"
            aria-label="Tìm nhân sự"
          />
        </div>
        <Select value={department} onValueChange={setDepartment}>
          <SelectTrigger className="sm:w-64">
            <SelectValue placeholder="Tất cả phòng ban" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_DEPARTMENTS}>Tất cả phòng ban</SelectItem>
            {departments.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {query.isPending ? <LoadingRows /> : null}
      {query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : null}

      {query.isSuccess && filtered.length === 0 ? (
        <EmptyState
          icon={ContactIcon}
          title="Không tìm thấy nhân sự phù hợp"
          description="Thử từ khoá khác hoặc bỏ bộ lọc phòng ban."
        />
      ) : null}

      {filtered.length > 0 ? (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nhân sự</TableHead>
                <TableHead className="hidden md:table-cell">Phòng ban</TableHead>
                <TableHead className="hidden lg:table-cell">Chức danh</TableHead>
                <TableHead className="hidden lg:table-cell">Liên hệ</TableHead>
                <TableHead>Trạng thái</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => {
                const name = text(row[F.employee.fullName]) || "Chưa đặt tên";
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="size-9">
                          <AvatarFallback>{initials(name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{name}</p>
                          <p className="truncate text-muted-foreground text-xs">
                            {text(row[F.employee.code]) || text(row[F.employee.workEmail]) || "—"}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {display(row[F.employee.departmentName])}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {display(row[F.employee.jobTitleName])}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <div className="space-y-0.5 text-sm">
                        <p>{display(row[F.employee.workEmail])}</p>
                        <p className="text-muted-foreground">{display(row[F.employee.phone])}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {text(row[F.employee.workStatus]) ? (
                        <Badge variant="outline">{text(row[F.employee.workStatus])}</Badge>
                      ) : (
                        display(null)
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      ) : null}
    </section>
  );
}
