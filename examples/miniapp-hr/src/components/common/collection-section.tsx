"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { LucideIcon } from "lucide-react";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { type DefaultValues, type FieldValues, useForm } from "react-hook-form";
import type { z } from "zod";
import { type DetailItem, DetailList } from "@/components/common/detail-list";
import { type FormFieldConfig, FormFields } from "@/components/common/record-form";
import { SectionHeader } from "@/components/common/section-header";
import { EmptyState, ErrorState, LoadingRows } from "@/components/common/states";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useCollection, useDeleteRecord, useSaveRecord } from "@/hooks/use-hr";
import type { RecordRow } from "@/lib/domain/types";

export interface CollectionCard {
  title: string;
  subtitle?: string;
  badges?: { label: string; variant?: "default" | "secondary" | "outline" | "destructive" }[];
  details: DetailItem[];
}

export interface CollectionSectionProps<TValues extends FieldValues> {
  /** API segment under `api/`, also the react-query cache key. */
  path: string;
  icon: LucideIcon;
  title: string;
  description: string;
  addLabel: string;
  formTitle: string;
  formDescription?: string;
  schema: z.ZodType<TValues, TValues>;
  fields: FormFieldConfig[];
  emptyValues: TValues;
  toValues: (row: RecordRow) => TValues;
  card: (row: RecordRow) => CollectionCard;
  emptyTitle: string;
  emptyDescription: string;
}

/**
 * One employee-owned table rendered as an editable list: the section only
 * describes its columns and its form, everything else (loading, dialogs,
 * validation, cache invalidation) is shared.
 */
export function CollectionSection<TValues extends FieldValues>({
  path,
  icon,
  title,
  description,
  addLabel,
  formTitle,
  formDescription,
  schema,
  fields,
  emptyValues,
  toValues,
  card,
  emptyTitle,
  emptyDescription,
}: CollectionSectionProps<TValues>) {
  const query = useCollection(path);
  const save = useSaveRecord(path);
  const remove = useDeleteRecord(path);

  const [editing, setEditing] = useState<RecordRow | null>(null);
  const [open, setOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RecordRow | null>(null);

  const form = useForm<TValues>({
    resolver: zodResolver(schema),
    defaultValues: emptyValues as DefaultValues<TValues>,
  });

  const openCreate = () => {
    setEditing(null);
    form.reset(emptyValues as DefaultValues<TValues>);
    setOpen(true);
  };

  const openEdit = (row: RecordRow) => {
    setEditing(row);
    form.reset(toValues(row) as DefaultValues<TValues>);
    setOpen(true);
  };

  const submit = form.handleSubmit(async (values) => {
    await save.mutateAsync({ id: editing?.id, values });
    setOpen(false);
  });

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    await remove.mutateAsync(pendingDelete.id);
    setPendingDelete(null);
  };

  const items = query.data?.items ?? [];

  return (
    <section className="space-y-6">
      <SectionHeader
        icon={icon}
        title={title}
        description={description}
        action={
          <Button onClick={openCreate}>
            <PlusIcon />
            {addLabel}
          </Button>
        }
      />

      {query.isPending ? <LoadingRows /> : null}
      {query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : null}

      {query.isSuccess && items.length === 0 ? (
        <EmptyState
          icon={icon}
          title={emptyTitle}
          description={emptyDescription}
          action={
            <Button variant="outline" onClick={openCreate}>
              <PlusIcon />
              {addLabel}
            </Button>
          }
        />
      ) : null}

      <div className="grid gap-4">
        {items.map((row) => {
          const content = card(row);
          return (
            <Card key={row.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {content.title}
                  {content.badges?.map((badge) => (
                    <Badge key={badge.label} variant={badge.variant ?? "secondary"}>
                      {badge.label}
                    </Badge>
                  ))}
                </CardTitle>
                {content.subtitle ? <CardDescription>{content.subtitle}</CardDescription> : null}
                <CardAction className="flex gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Sửa"
                    onClick={() => openEdit(row)}
                  >
                    <PencilIcon />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Xoá"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setPendingDelete(row)}
                  >
                    <Trash2Icon />
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                <DetailList items={content.details} />
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? `Sửa ${formTitle.toLowerCase()}` : formTitle}</DialogTitle>
            {formDescription ? <DialogDescription>{formDescription}</DialogDescription> : null}
          </DialogHeader>

          <form onSubmit={submit} className="space-y-6">
            <FormFields form={form} fields={fields} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Huỷ
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? <Spinner /> : null}
                Lưu
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => !next && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xoá bản ghi này?</AlertDialogTitle>
            <AlertDialogDescription>
              Bản ghi sẽ được gỡ khỏi hồ sơ của bạn. Thao tác này không thể hoàn tác trong app.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={remove.isPending}>
              Xoá
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
