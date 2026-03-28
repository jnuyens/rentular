"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2, Users, FileText, CreditCard, TrendingUp,
  MessageSquare, Wrench, Settings, Download, LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import LanguageSwitcher from "@/components/LanguageSwitcher";

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Building2, Users, FileText, CreditCard, TrendingUp,
  MessageSquare, Wrench, Settings, Download,
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
    <aside className="hidden md:flex w-64 flex-col border-r border-border bg-background">
      <div className="flex h-16 items-center gap-2 px-6">
        <Image src="/rentular.png" alt="Rentular" width={48} height={48} />
        <span className="text-xl font-bold">Rentular</span>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {items.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.key}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {(() => { const Icon = iconMap[item.iconName]; return Icon ? <Icon className="h-5 w-5" /> : null; })()}
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-4">
        <div className="mb-3">
          <LanguageSwitcher dropDirection="up" />
        </div>
        <div className="flex items-center gap-3">
          {userImage && (
            <img
              src={userImage}
              alt=""
              className="h-8 w-8 rounded-full"
            />
          )}
          <div className="flex-1 truncate">
            <p className="text-sm font-medium">{userName}</p>
            <p className="truncate text-xs text-muted-foreground">
              {userEmail}
            </p>
          </div>
          <form action={signOutAction}>
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </div>
    </aside>
  );
}
