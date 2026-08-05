import { cn } from "@/lib/utils";

export interface DetailItem {
  label: string;
  value: React.ReactNode;
}

/** Reads a display value, falling back to a dash so empty cells stay aligned. */
export function display(value: unknown): React.ReactNode {
  if (value === null || value === undefined || String(value).trim() === "") {
    return <span className="text-muted-foreground/60">—</span>;
  }
  if (typeof value === "boolean") return value ? "Có" : "Không";
  return String(value);
}

export function DetailList({
  items,
  columns = 2,
  className,
}: {
  items: DetailItem[];
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <dl
      className={cn(
        "grid gap-x-6 gap-y-3",
        columns === 1 && "grid-cols-1",
        columns === 2 && "sm:grid-cols-2",
        columns === 3 && "sm:grid-cols-2 lg:grid-cols-3",
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="min-w-0 space-y-0.5">
          <dt className="text-muted-foreground text-xs uppercase tracking-wide">{item.label}</dt>
          <dd className="break-words font-medium text-foreground text-sm">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
