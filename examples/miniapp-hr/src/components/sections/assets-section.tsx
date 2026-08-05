"use client";

import { PackageIcon } from "lucide-react";
import { DetailList, display } from "@/components/common/detail-list";
import { SectionHeader } from "@/components/common/section-header";
import { EmptyState, ErrorState, LoadingRows } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAssets } from "@/hooks/use-hr";
import type { RecordRow } from "@/lib/domain/types";
import { F } from "@/lib/erp/schema";
import { formatDate, text } from "@/lib/format";

function handoverVariant(status: string) {
  if (status === "Đã thu hồi") return "secondary" as const;
  if (status === "Mất/Hỏng") return "destructive" as const;
  return "default" as const;
}

function AssignmentCard({ row }: { row: RecordRow }) {
  const status = text(row[F.assetAssignment.handoverStatus]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {text(row[F.assetAssignment.assetName]) || "Tài sản"}
          {status ? <Badge variant={handoverVariant(status)}>{status}</Badge> : null}
        </CardTitle>
        <CardDescription>{text(row[F.assetAssignment.assetCode]) || "—"}</CardDescription>
      </CardHeader>
      <CardContent>
        <DetailList
          columns={3}
          items={[
            { label: "Ngày cấp", value: display(formatDate(row[F.assetAssignment.issuedDate])) },
            {
              label: "Ngày thu hồi",
              value: display(formatDate(row[F.assetAssignment.returnedDate])),
            },
            { label: "Số lượng", value: display(row[F.assetAssignment.quantity]) },
            { label: "Ghi chú", value: display(row[F.assetAssignment.note]) },
          ]}
        />
      </CardContent>
    </Card>
  );
}

export function AssetsSection() {
  const query = useAssets();

  return (
    <section className="space-y-6">
      <SectionHeader
        icon={PackageIcon}
        title="Tài sản của tôi"
        description="Tài sản công ty đang cấp phát cho bạn, đối chiếu với danh mục tài sản của công ty. Danh sách này do bộ phận quản lý tài sản cập nhật."
      />

      {query.isPending ? <LoadingRows /> : null}
      {query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : null}

      {query.isSuccess ? (
        <Tabs defaultValue="assigned">
          <TabsList>
            <TabsTrigger value="assigned">
              Đang cấp phát ({query.data.assignments.length})
            </TabsTrigger>
            <TabsTrigger value="catalog">
              Danh mục tài sản ({query.data.catalog.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="assigned" className="space-y-4 pt-4">
            {query.data.assignments.length === 0 ? (
              <EmptyState
                icon={PackageIcon}
                title="Bạn chưa được cấp phát tài sản nào"
                description="Khi công ty bàn giao thiết bị, phiếu cấp phát sẽ xuất hiện ở đây."
              />
            ) : (
              query.data.assignments.map((row) => <AssignmentCard key={row.id} row={row} />)
            )}
          </TabsContent>

          <TabsContent value="catalog" className="pt-4">
            {query.data.catalog.length === 0 ? (
              <EmptyState
                icon={PackageIcon}
                title="Danh mục tài sản đang trống"
                description="Bảng “Danh mục tài sản” chưa có dữ liệu trong workspace."
              />
            ) : (
              <Card className="overflow-hidden py-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mã</TableHead>
                      <TableHead>Tên tài sản</TableHead>
                      <TableHead>Loại</TableHead>
                      <TableHead>Đơn vị</TableHead>
                      <TableHead>Tình trạng</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {query.data.catalog.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">{display(row[F.asset.code])}</TableCell>
                        <TableCell>{display(row[F.asset.name])}</TableCell>
                        <TableCell>{display(row[F.asset.category])}</TableCell>
                        <TableCell>{display(row[F.asset.unit])}</TableCell>
                        <TableCell>
                          {text(row[F.asset.status]) ? (
                            <Badge variant="outline">{text(row[F.asset.status])}</Badge>
                          ) : (
                            display(null)
                          )}
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
