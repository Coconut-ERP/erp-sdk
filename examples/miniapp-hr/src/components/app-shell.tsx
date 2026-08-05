"use client";

import { BuildingIcon } from "lucide-react";
import { GROUP_LABELS, NAV_ITEMS, type NavItem, type SectionId } from "@/components/navigation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/hooks/use-hr";
import { F } from "@/lib/erp/schema";
import { initials, text } from "@/lib/format";
import { cn } from "@/lib/utils";

const GROUPS: NavItem["group"][] = ["personal", "company"];

function UserChip() {
  const me = useMe();

  if (me.isPending) {
    return <Skeleton className="h-9 w-36 rounded-full" />;
  }

  if (!me.data) return null;

  const name = text(me.data.employee[F.employee.fullName]) || me.data.user.displayName;

  return (
    <div className="flex items-center gap-2.5">
      <div className="hidden text-right sm:block">
        <p className="font-medium text-sm leading-tight">{name}</p>
        <p className="text-muted-foreground text-xs leading-tight">{me.data.user.email}</p>
      </div>
      <Avatar className="size-9">
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>
    </div>
  );
}

export function AppShell({
  active,
  onNavigate,
  children,
}: {
  active: SectionId;
  onNavigate: (section: SectionId) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <BuildingIcon className="size-5" />
            </span>
            <div className="leading-tight">
              <p className="font-semibold text-sm">Cổng thông tin nhân sự</p>
              <p className="text-muted-foreground text-xs">Hồ sơ của bạn, luôn cập nhật</p>
            </div>
          </div>
          <UserChip />
        </div>

        <ScrollArea className="lg:hidden">
          <div className="flex gap-1.5 px-4 pb-3">
            {NAV_ITEMS.map((item) => (
              <Button
                key={item.id}
                size="sm"
                variant={active === item.id ? "default" : "outline"}
                className="shrink-0"
                onClick={() => onNavigate(item.id)}
              >
                <item.icon />
                {item.label}
              </Button>
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </header>

      <div className="mx-auto flex w-full max-w-7xl gap-8 px-4 py-6 lg:px-6">
        <aside className="hidden w-60 shrink-0 lg:block">
          <nav className="sticky top-24 space-y-6">
            {GROUPS.map((group) => (
              <div key={group} className="space-y-1">
                <p className="px-3 pb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                  {GROUP_LABELS[group]}
                </p>
                {NAV_ITEMS.filter((item) => item.group === group).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onNavigate(item.id)}
                    aria-current={active === item.id ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                      active === item.id
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <item.icon className="size-4 shrink-0" />
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 pb-12">{children}</main>
      </div>
    </div>
  );
}
