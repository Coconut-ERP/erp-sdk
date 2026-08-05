import { cn } from "@/lib/utils";

const SEGMENTS = 10;

/** A segmented gauge — avoids inline widths while still reading as a progress bar. */
export function CompletionBar({ value, className }: { value: number; className?: string }) {
  const filled = Math.round((Math.min(Math.max(value, 0), 100) / 100) * SEGMENTS);

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="flex flex-1 gap-1" role="presentation">
        {Array.from({ length: SEGMENTS }, (_, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional by nature
            key={index}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors",
              index < filled ? "bg-primary" : "bg-border",
            )}
          />
        ))}
      </div>
      <span className="font-medium text-muted-foreground text-xs tabular-nums">{value}%</span>
    </div>
  );
}
