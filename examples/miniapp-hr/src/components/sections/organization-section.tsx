"use client";

import { NetworkIcon } from "lucide-react";
import { display } from "@/components/common/detail-list";
import { SectionHeader } from "@/components/common/section-header";
import { EmptyState, ErrorState, LoadingRows } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useReferences } from "@/hooks/use-hr";
import { F } from "@/lib/erp/schema";
import { text } from "@/lib/format";

export function OrganizationSection() {
  const query = useReferences();

  return (
    <section className="space-y-6">
      <SectionHeader
        icon={NetworkIcon}
        title="Cơ cấu tổ chức"
        description="Danh mục phòng ban và chức danh của công ty — dùng chung cho hồ sơ và quá trình công tác."
      />

      {query.isPending ? <LoadingRows /> : null}
      {query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : null}

      {query.isSuccess ? (
        <Tabs defaultValue="departments">
          <TabsList>
            <TabsTrigger value="departments">
              Phòng ban ({query.data.departments.length})
            </TabsTrigger>
            <TabsTrigger value="job-titles">Chức danh ({query.data.jobTitles.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="departments" className="pt-4">
            {query.data.departments.length === 0 ? (
              <EmptyState
                icon={NetworkIcon}
                title="Chưa có phòng ban"
                description="Bảng “Phòng ban” trong workspace chưa có dữ liệu."
              />
            ) : (
              <Card className="overflow-hidden py-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mã</TableHead>
                      <TableHead>Tên phòng ban</TableHead>
                      <TableHead className="hidden md:table-cell">Trực thuộc</TableHead>
                      <TableHead className="hidden lg:table-cell">Mô tả</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {query.data.departments.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">
                          {display(row[F.department.code])}
                        </TableCell>
                        <TableCell>{display(row[F.department.name])}</TableCell>
                        <TableCell className="hidden md:table-cell">
                          {display(row[F.department.parentName])}
                        </TableCell>
                        <TableCell className="hidden max-w-md lg:table-cell">
                          {display(row[F.department.description])}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="job-titles" className="pt-4">
            {query.data.jobTitles.length === 0 ? (
              <EmptyState
                icon={NetworkIcon}
                title="Chưa có chức danh"
                description="Bảng “Chức danh” trong workspace chưa có dữ liệu."
              />
            ) : (
              <Card className="overflow-hidden py-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mã</TableHead>
                      <TableHead>Tên chức danh</TableHead>
                      <TableHead>Cấp bậc</TableHead>
                      <TableHead className="hidden lg:table-cell">Mô tả</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {query.data.jobTitles.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">
                          {display(row[F.jobTitle.code])}
                        </TableCell>
                        <TableCell>{display(row[F.jobTitle.name])}</TableCell>
                        <TableCell>
                          {text(row[F.jobTitle.level]) ? (
                            <Badge variant="secondary">{text(row[F.jobTitle.level])}</Badge>
                          ) : (
                            display(null)
                          )}
                        </TableCell>
                        <TableCell className="hidden max-w-md lg:table-cell">
                          {display(row[F.jobTitle.description])}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      ) : null}
    </section>
  );
}
