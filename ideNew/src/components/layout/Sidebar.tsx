import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  FiGrid,
  FiSettings,
  FiFileText,
  FiUsers,
  FiCode,
  FiLayers,
  FiPackage,
  FiAlertCircle,
  FiActivity,
  FiServer,
} from "react-icons/fi";
import { Button } from "@/components/ui/Button";
import { useSessionToken } from "@/lib/client/session";
import { hasPermissionFromUser, toPermissionArray } from "@/lib/client/access";
import type { IdePermission } from "@/lib/rbac";
import Image from "next/image";
import branding from "@/branding.json";

type SidebarProps = {
  open: boolean;
  onClose?: () => void;
};

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  match?: string;
  permission?: IdePermission;
};

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: FiGrid, match: "/dashboard" },
  { label: "Docs", href: "/docs", icon: FiFileText, match: "/docs" },
  { label: "Editor", href: "/editor", icon: FiCode, match: "/editor" },
  {
    label: "Tenants",
    href: "/admin/tenants",
    icon: FiLayers,
    match: "/admin/tenants",
    permission: "ide.tenants.read",
  },
  {
    label: "Shared Projects",
    href: "/admin/shared-packages",
    icon: FiPackage,
    match: "/admin/shared-packages",
    permission: "ide.shared_ui.read",
  },
  {
    label: "Shared Backend Modules",
    href: "/admin/shared-modules",
    icon: FiPackage,
    match: "/admin/shared-modules",
    permission: "ide.shared_modules.read",
  },
  {
    label: "Teams",
    href: "/admin/teams",
    icon: FiUsers,
    match: "/admin/teams",
    permission: "ide.users.read",
  },
  {
    label: "Users",
    href: "/admin/users",
    icon: FiUsers,
    match: "/admin/users",
    permission: "ide.users.read",
  },
  {
    label: "Logs",
    href: "/admin/logs",
    icon: FiAlertCircle,
    match: "/admin/logs",
    permission: "ide.logs.read",
  },
  {
    label: "Monitoring",
    href: "/admin/monitoring",
    icon: FiActivity,
    match: "/admin/monitoring",
    permission: "ide.monitoring.read",
  },
  {
    label: "Containers",
    href: "/admin/containers",
    icon: FiServer,
    match: "/admin/containers",
    permission: "ide.containers.read",
  },
  {
    label: "System Settings",
    href: "/admin/settings",
    icon: FiSettings,
    match: "/admin/settings",
    permission: "ide.settings.manage",
  },
];

export const Sidebar = ({ open, onClose }: SidebarProps) => {
  const router = useRouter();
  const { token, ready } = useSessionToken();
  const [userAccess, setUserAccess] = useState<{
    role: string;
    permissions: IdePermission[];
  }>({ role: "user", permissions: [] });

  useEffect(() => {
    const load = async () => {
      if (!ready || !token) return;
      try {
        const res = await fetch("/api/me", {
          headers: { Authorization: `Session ${token}` },
        });
        const data = await res.json();
        if (res.ok && data?.user) {
          setUserAccess({
            role: String(data.user.role || "user"),
            permissions: toPermissionArray(data.user.permissions),
          });
        }
      } catch (e) {
        // ignore role load errors; default user
      }
    };
    load();
  }, [token, ready]);

  const visibleNavItems = useMemo(
    () =>
      navItems.filter(
        (item) =>
          !item.permission ||
          hasPermissionFromUser(
            { role: userAccess.role, permissions: userAccess.permissions },
            item.permission
          )
      ),
    [userAccess.permissions, userAccess.role]
  );

  return (
    <>
      <div
        className={`fixed inset-0 z-20 bg-bgApp opacity-60 transition-opacity lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
      />
      <aside
        className={`fixed left-0 top-0 z-30 flex h-screen w-72 flex-col flex-shrink-0 border-r border-borderSubtle bg-bgApp text-textPrimary shadow-soft transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0 lg:overflow-y-auto`}
        dir="ltr"
      >
        <div className="flex h-16 items-center bg-primaryDark justify-center px-4 sm:px-6 text-left border-b border-borderSubtle">
          <div className="flex items-center gap-3">
            <div className="flex h-11 items-center justify-center rounded-xl text-sm font-semibold text-textPrimary">
              <Image
                src={branding.logo_lw}
                alt={branding.brand_name}
                width={100}
                height={30}
              />
            </div>
          </div>
        </div>

        <nav className="mt-3 flex-1 space-y-1 px-3">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const activePath = item.match || item.href;
            const isActive =
              router.pathname === activePath ||
              router.pathname.startsWith(`${activePath}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`group flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition text-left ${
                  isActive
                    ? "border border-l-4 border-primary bg-primaryDark text-textPrimary shadow-none"
                    : "border border-transparent text-textMuted hover:border-borderSubtle hover:bg-bgSurface"
                }`}
              >
                <Icon
                  className={`h-5 w-5 ${
                    isActive ? "text-textPrimary" : "text-textMuted"
                  }`}
                />
                <span className="flex-1 text-left">{item.label}</span>
                {isActive && (
                  <span className="ml-auto h-2.5 w-2.5 rounded-full bg-primary" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-borderSubtle px-5 py-4 text-sm text-textMuted">
          © {new Date().getFullYear()}  · {branding.brand_name}
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
