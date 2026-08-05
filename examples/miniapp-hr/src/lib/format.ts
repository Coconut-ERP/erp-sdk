/** Reads a cell as a plain string, treating null/undefined as empty. */
export const text = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value);

export const bool = (value: unknown): boolean => value === true || value === "true";

/** ERP stores dates as `YYYY-MM-DD`; people read them as `DD/MM/YYYY`. */
export function formatDate(value: unknown): string {
  const raw = text(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : raw;
}

export function formatDateTime(value: unknown): string {
  const raw = text(value);
  if (!raw) return "";
  const date = new Date(raw);
  return Number.isNaN(date.getTime())
    ? raw
    : new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export function formatCurrency(value: unknown): string {
  const amount = Number(value);
  return Number.isFinite(amount) && text(value) !== ""
    ? new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount)
    : "";
}

export function formatRange(from: unknown, to: unknown): string {
  const start = formatDate(from);
  const end = formatDate(to);
  if (!start && !end) return "";
  return `${start || "…"} → ${end || "nay"}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const last = parts[parts.length - 1] ?? "";
  const first = parts.length > 1 ? (parts[parts.length - 2] ?? "") : "";
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() || "?";
}
