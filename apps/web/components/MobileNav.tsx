"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Building2, Users, FileText, CreditCard, TrendingUp,
  MessageSquare, Wrench, Settings, Download, Menu, LogOut,
  FileSignature, Banknote, ArrowLeftRight,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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

interface MobileNavProps {
  items: NavItem[];
  userName?: string | null;
  userEmail?: string | null;
  signOutAction: () => Promise<void>;
}

export default function MobileNav({
  items,
  userName,
  userEmail,
  signOutAction,
}: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Derive current page title from pathname
  const currentItem = items.find(
    (item) => pathname === item.href || pathname.startsWith(item.href + "/")
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 h-14 flex items-center gap-3 bg-brand-gradient px-4 text-white shadow-md">
        <Sheet open={open} onOpenChange={setOpen}>
          <button
            type="button"
            aria-label="Open navigation"
            onClick={() => setOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-white transition-colors hover:bg-white/10"
          >
            <Menu className="h-5 w-5" />
          </button>

          <SheetContent
            side="left"
            className="w-64 border-r-0 bg-brand-gradient p-0 text-white [&>button]:data-[state=open]:bg-transparent"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation</SheetTitle>
            </SheetHeader>

            {/* Sheet sidebar content */}
            <div className="flex h-full flex-col">
              {/* Big logo that hangs over the header line on purpose. */}
              <div className="relative flex h-16 items-center border-b border-white/10 pl-[6.75rem] pr-6">
                <Image
                  src="/rentular.png"
                  alt="Rentular"
                  width={82}
                  height={90}
                  className="absolute left-4 top-3 z-10 h-[90px] w-[82px]"
                />
                <span className="text-2xl font-bold text-white">Rentular</span>
              </div>

              <nav className="flex-1 space-y-1 px-3 pb-4 pt-12">
                {items.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      aria-current={isActive ? "page" : undefined}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                        isActive
                          ? "bg-green-pill font-semibold text-navy shadow-md shadow-black/20"
                          : "text-white/85 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      {(() => { const Icon = iconMap[item.iconName]; return Icon ? <Icon className="h-5 w-5" /> : null; })()}
                      {item.label}
                    </Link>
                  );
                })}
              </nav>

              <div className="border-t border-white/10 p-4">
                <div className="mb-3">
                  <LanguageSwitcher dropDirection="up" tone="dark" />
                </div>
                <div className="flex items-center gap-3">
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
            </div>
          </SheetContent>
        </Sheet>

        <Image src="/rentular.png" alt="Rentular" width={28} height={28} />
        <span className="font-semibold text-white">Rentular</span>

        {currentItem && (
          <span className="ml-auto text-sm text-white/75">
            {currentItem.label}
          </span>
        )}
      </div>
    </>
  );
}
