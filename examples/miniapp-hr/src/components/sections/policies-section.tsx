"use client";

import { BookOpenTextIcon, ExternalLinkIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { DetailList, display } from "@/components/common/detail-list";
import { SectionHeader } from "@/components/common/section-header";
import { EmptyState, ErrorState, LoadingRows } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { usePolicies } from "@/hooks/use-hr";
import type { RecordRow } from "@/lib/domain/types";
import { F } from "@/lib/erp/schema";
import { formatDate, text } from "@/lib/format";

function statusVariant(status: string) {
  if (status === "Hiệu lực") return "default" as const;
  if (status === "Hết hiệu lực") return "outline" as const;
  return "secondary" as const;
}

export function PoliciesSection() {
  const query = usePolicies();
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<RecordRow | null>(null);

  const filtered = useMemo(() => {
    const rows = query.data?.items ?? [];
    const needle = keyword.trim().toLowerCase();
    if (!needle) return rows;

    return rows.filter((row) =>
      [F.policy.title, F.policy.code, F.policy.kind, F.policy.summary, F.policy.content].some(
        (column) => text(row[column]).toLowerCase().includes(needle),
      ),
    );
  }, [query.data, keyword]);

  return (
    <section className="space-y-6">
      <SectionHeader
        icon={BookOpenTextIcon}
        title="Quy định & chính sách"
        description="Văn bản nội bộ đang áp dụng: quy định, chính sách phúc lợi, quy trình và biểu mẫu."
      />

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
        <Input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="Tìm theo tiêu đề, mã văn bản hoặc nội dung…"
          className="pl-9"
          aria-label="Tìm văn bản"
        />
      </div>

      {query.isPending ? <LoadingRows /> : null}
      {query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : null}

      {query.isSuccess && filtered.length === 0 ? (
        <EmptyState
          icon={BookOpenTextIcon}
          title="Chưa có văn bản nào"
          description="Khi công ty ban hành quy định mới, văn bản sẽ hiển thị tại đây."
        />
      ) : null}

      <div className="grid gap-4">
        {filtered.map((row) => {
          const status = text(row[F.policy.status]);
          const url = text(row[F.policy.documentUrl]);

          return (
            <Card key={row.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {text(row[F.policy.title]) || "Văn bản chưa đặt tiêu đề"}
                  {text(row[F.policy.kind]) ? (
                    <Badge variant="secondary">{text(row[F.policy.kind])}</Badge>
                  ) : null}
                  {status ? <Badge variant={statusVariant(status)}>{status}</Badge> : null}
                </CardTitle>
                <CardDescription>
                  {[text(row[F.policy.code]), text(row[F.policy.departmentName])]
                    .filter(Boolean)
                    .join(" · ") || "Áp dụng toàn công ty"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <DetailList
                  columns={3}
                  items={[
                    {
                      label: "Ngày ban hành",
                      value: display(formatDate(row[F.policy.issuedDate])),
                    },
                    {
                      label: "Ngày hiệu lực",
                      value: display(formatDate(row[F.policy.effectiveDate])),
                    },
                    { label: "Tóm tắt", value: display(row[F.policy.summary]) },
                  ]}
                />
                <div className="flex flex-wrap gap-2">
                  {text(row[F.policy.content]) ? (
                    <Button variant="outline" size="sm" onClick={() => setSelected(row)}>
                      Xem nội dung
                    </Button>
                  ) : null}
                  {url ? (
                    <Button variant="ghost" size="sm" asChild>
                      <a href={url} target="_blank" rel="noreferrer noopener">
                        <ExternalLinkIcon />
                        Mở tài liệu
                      </a>
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{text(selected?.[F.policy.title]) || "Nội dung văn bản"}</DialogTitle>
            <DialogDescription>
              {[text(selected?.[F.policy.code]), formatDate(selected?.[F.policy.effectiveDate])]
                .filter(Boolean)
                .join(" · ")}
            </DialogDescription>
          </DialogHeader>
          <p className="whitespace-pre-wrap text-foreground text-sm leading-relaxed">
            {text(selected?.[F.policy.content])}
          </p>
        </DialogContent>
      </Dialog>
    </section>
  );
}
