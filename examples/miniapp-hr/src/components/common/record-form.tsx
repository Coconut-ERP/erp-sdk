"use client";

import { Controller, type FieldValues, type Path, type UseFormReturn } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

export type FormFieldKind =
  | "text"
  | "email"
  | "tel"
  | "date"
  | "number"
  | "textarea"
  | "select"
  | "checkbox";

export interface FormFieldConfig {
  name: string;
  label: string;
  kind?: FormFieldKind;
  options?: SelectOption[];
  placeholder?: string;
  description?: string;
  /** Selects render an explicit "not chosen" entry with this label. */
  emptyLabel?: string;
  colSpan?: 1 | 2;
}

/** Radix rejects an empty string as an item value, so "unset" needs a sentinel. */
const NONE = "__none__";

export const toOptions = (values: readonly string[]): SelectOption[] =>
  values.map((value) => ({ value, label: value }));

/**
 * Keeps a stored value selectable even when it is not in the offered list —
 * the workspace may have grown an option this build does not know about.
 */
function withCurrent(options: SelectOption[] | undefined, current: string): SelectOption[] {
  const list = options ?? [];
  if (!current || list.some((option) => option.value === current)) return list;
  return [...list, { value: current, label: current }];
}

function fieldError(form: UseFormReturn<FieldValues>, name: string): string | undefined {
  const error = form.formState.errors[name];
  return typeof error?.message === "string" ? error.message : undefined;
}

interface FormFieldsProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  fields: FormFieldConfig[];
  className?: string;
}

export function FormFields<T extends FieldValues>({ form, fields, className }: FormFieldsProps<T>) {
  // The config addresses fields by name; the cast keeps that ergonomic without
  // giving up type safety at the call sites that build the config.
  const typedForm = form as unknown as UseFormReturn<FieldValues>;

  return (
    <div className={cn("grid gap-5 sm:grid-cols-2", className)}>
      {fields.map((config) => {
        const name = config.name as Path<FieldValues>;
        const kind = config.kind ?? "text";
        const error = fieldError(typedForm, config.name);
        const wide = config.colSpan === 2 || kind === "textarea";

        if (kind === "checkbox") {
          return (
            <Field
              key={config.name}
              orientation="horizontal"
              data-invalid={error ? true : undefined}
              className={cn("items-start", wide && "sm:col-span-2")}
            >
              <Controller
                control={typedForm.control}
                name={name}
                render={({ field }) => (
                  <Checkbox
                    id={config.name}
                    checked={Boolean(field.value)}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                    onBlur={field.onBlur}
                  />
                )}
              />
              <FieldContent>
                <FieldLabel htmlFor={config.name}>{config.label}</FieldLabel>
                {config.description ? (
                  <FieldDescription>{config.description}</FieldDescription>
                ) : null}
              </FieldContent>
            </Field>
          );
        }

        return (
          <Field
            key={config.name}
            data-invalid={error ? true : undefined}
            className={cn(wide && "sm:col-span-2")}
          >
            <FieldLabel htmlFor={config.name}>{config.label}</FieldLabel>

            {kind === "select" ? (
              <Controller
                control={typedForm.control}
                name={name}
                render={({ field }) => {
                  const current = field.value ? String(field.value) : "";
                  return (
                    <Select
                      value={current || NONE}
                      onValueChange={(value) => field.onChange(value === NONE ? "" : value)}
                    >
                      <SelectTrigger id={config.name} className="w-full">
                        <SelectValue placeholder={config.placeholder ?? "Chọn…"} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>{config.emptyLabel ?? "Chưa chọn"}</SelectItem>
                        {withCurrent(config.options, current).map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            <span>{option.label}</span>
                            {option.hint ? (
                              <span className="text-muted-foreground text-xs">{option.hint}</span>
                            ) : null}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  );
                }}
              />
            ) : kind === "textarea" ? (
              <Textarea
                id={config.name}
                rows={3}
                placeholder={config.placeholder}
                aria-invalid={error ? true : undefined}
                {...typedForm.register(name)}
              />
            ) : (
              <Input
                id={config.name}
                type={kind === "text" ? "text" : kind}
                placeholder={config.placeholder}
                aria-invalid={error ? true : undefined}
                {...typedForm.register(name)}
              />
            )}

            {config.description ? <FieldDescription>{config.description}</FieldDescription> : null}
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
        );
      })}
    </div>
  );
}
