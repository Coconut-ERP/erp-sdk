"use client";

import { PlugZapIcon } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import type { SectionId } from "@/components/navigation";
import { AssetsSection } from "@/components/sections/assets-section";
import { DependentsSection } from "@/components/sections/dependents-section";
import { DirectorySection } from "@/components/sections/directory-section";
import { EmergencyContactsSection } from "@/components/sections/emergency-contacts-section";
import { OrganizationSection } from "@/components/sections/organization-section";
import { OverviewSection } from "@/components/sections/overview-section";
import { PoliciesSection } from "@/components/sections/policies-section";
import { ProfileSection } from "@/components/sections/profile-section";
import { QualificationsSection } from "@/components/sections/qualifications-section";
import { WorkHistorySection } from "@/components/sections/work-history-section";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useMe } from "@/hooks/use-hr";
import { ApiError } from "@/lib/client/api";

function Disconnected({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message = error instanceof Error ? error.message : "Không kết nối được tới ERP";

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <Card className="max-w-md">
        <CardHeader>
          <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <PlugZapIcon className="size-5" />
          </span>
          <CardTitle>Chưa nhận được danh tính người dùng</CardTitle>
          <CardDescription>
            App này chạy bên trong ERP và nhận danh tính qua initData. Hãy mở app từ danh sách mini
            app trong ERP thay vì mở trực tiếp bằng URL.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="rounded-lg bg-muted px-3 py-2 text-muted-foreground text-sm">{message}</p>
          <Button onClick={onRetry}>Thử lại</Button>
        </CardContent>
      </Card>
    </main>
  );
}

function Section({ id, onNavigate }: { id: SectionId; onNavigate: (next: SectionId) => void }) {
  switch (id) {
    case "overview":
      return <OverviewSection onNavigate={onNavigate} />;
    case "profile":
      return <ProfileSection />;
    case "emergency-contacts":
      return <EmergencyContactsSection />;
    case "dependents":
      return <DependentsSection />;
    case "qualifications":
      return <QualificationsSection />;
    case "work-history":
      return <WorkHistorySection />;
    case "assets":
      return <AssetsSection />;
    case "directory":
      return <DirectorySection />;
    case "organization":
      return <OrganizationSection />;
    case "policies":
      return <PoliciesSection />;
  }
}

export default function HomePage() {
  const [section, setSection] = useState<SectionId>("overview");
  const me = useMe();

  if (me.isPending) {
    return (
      <main className="flex min-h-dvh items-center justify-center gap-3 text-muted-foreground">
        <Spinner className="size-5" />
        Đang kết nối tới ERP…
      </main>
    );
  }

  // Anything other than a server fault means the app never got a usable identity.
  if (me.isError && !(me.error instanceof ApiError && me.error.status >= 500)) {
    return <Disconnected error={me.error} onRetry={() => me.refetch()} />;
  }

  return (
    <AppShell active={section} onNavigate={setSection}>
      <Section id={section} onNavigate={setSection} />
    </AppShell>
  );
}
