"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Building2, Users, FileText, CreditCard, TrendingUp,
  MessageSquare, Wrench, Settings, Download, LogOut,
  FileSignature, Banknote, ArrowLeftRight,
} from "lucide-react";
import LanguageSwitcher from "@/components/LanguageSwitcher";

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard, Building2, Users, FileText, CreditCard, TrendingUp,
  MessageSquare, Wrench, Settings, Download, FileSignature, Banknote,
  ArrowLeftRight,
};

interface NavItem {
  key: string;
  href: string;
  label: string;
  iconName: string;
}

interface DashboardSidebarProps {
  items: NavItem[];
  userName?: string | null;
  userEmail?: string | null;
  userImage?: string | null;
  signOutAction: () => Promise<void>;
}

export default function DashboardSidebar({
  items,
  userName,
  userEmail,
  userImage,
  signOutAction,
}: DashboardSidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="relative hidden w-64 shrink-0 flex-col overflow-hidden bg-brand-gradient text-white md:flex">
      <Link href="/overview" className="flex flex-col items-center gap-1 px-6 pb-4 pt-6">
        <Image src="/brand/logo-mark.png" alt="" width={136} height={104} priority className="h-[104px] w-auto" />
        <span className="text-2xl font-bold tracking-tight text-white">Rentular</span>
      </Link>

      <nav className="relative z-10 flex-1 space-y-1 overflow-y-auto px-3 py-3">
        {items.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = iconMap[item.iconName];
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-green-pill font-semibold text-navy shadow-md shadow-black/20"
                  : "text-white/85 hover:bg-white/10 hover:text-white"
              }`}
            >
              {Icon ? <Icon className="h-5 w-5" /> : null}
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Decorative wave behind the language switcher and user block */}
      <Image
        src="/brand/wave.svg"
        alt=""
        aria-hidden
        width={512}
        height={160}
        className="pointer-events-none absolute bottom-0 left-0 w-full select-none opacity-40"
      />

      <div className="relative z-10 border-t border-white/10 p-4">
        <div className="mb-3">
          <LanguageSwitcher dropDirection="up" tone="dark" />
        </div>
        <div className="flex items-center gap-3">
          {userImage && (
            <img
              src={userImage}
              alt=""
              className="h-9 w-9 rounded-full ring-2 ring-white/30"
            />
          )}
          <div className="flex-1 truncate">
            <p className="text-sm font-semibold text-white">{userName}</p>
            <p className="truncate text-xs text-white/70">
              {userEmail}
            </p>
          </div>
          <form action={signOutAction}>
            <button
              type="submit"
              aria-label="Sign out"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-white transition-colors hover:bg-white/10"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
