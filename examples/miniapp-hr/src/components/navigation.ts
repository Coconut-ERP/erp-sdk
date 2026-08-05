import {
  BookOpenTextIcon,
  BriefcaseBusinessIcon,
  ContactIcon,
  GraduationCapIcon,
  IdCardIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  NetworkIcon,
  PackageIcon,
  PhoneCallIcon,
  UsersIcon,
} from "lucide-react";

export type SectionId =
  | "overview"
  | "profile"
  | "emergency-contacts"
  | "dependents"
  | "qualifications"
  | "work-history"
  | "assets"
  | "directory"
  | "organization"
  | "policies";

export interface NavItem {
  id: SectionId;
  label: string;
  icon: LucideIcon;
  group: "personal" | "company";
}

export const NAV_ITEMS: NavItem[] = [
  { id: "overview", label: "Tổng quan", icon: LayoutDashboardIcon, group: "personal" },
  { id: "profile", label: "Hồ sơ của tôi", icon: IdCardIcon, group: "personal" },
  { id: "emergency-contacts", label: "Liên hệ khẩn cấp", icon: PhoneCallIcon, group: "personal" },
  { id: "dependents", label: "Người phụ thuộc", icon: UsersIcon, group: "personal" },
  {
    id: "qualifications",
    label: "Trình độ & bằng cấp",
    icon: GraduationCapIcon,
    group: "personal",
  },
  {
    id: "work-history",
    label: "Quá trình công tác",
    icon: BriefcaseBusinessIcon,
    group: "personal",
  },
  { id: "assets", label: "Tài sản của tôi", icon: PackageIcon, group: "personal" },
  { id: "directory", label: "Danh bạ nhân sự", icon: ContactIcon, group: "company" },
  { id: "organization", label: "Cơ cấu tổ chức", icon: NetworkIcon, group: "company" },
  { id: "policies", label: "Quy định & chính sách", icon: BookOpenTextIcon, group: "company" },
];

export const GROUP_LABELS: Record<NavItem["group"], string> = {
  personal: "Hồ sơ cá nhân",
  company: "Thông tin công ty",
};
