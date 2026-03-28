"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2, Users, FileText, CreditCard, TrendingUp,
  MessageSquare, Wrench, Settings, Download, Menu, LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 h-14 flex items-center gap-3 border-b bg-background px-4">
        <Sheet open={open} onOpenChange={setOpen}>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open navigation"
            onClick={() => setOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>

          <SheetContent side="left" className="w-64 p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation</SheetTitle>
            </SheetHeader>

            {/* Sheet sidebar content */}
            <div className="flex h-full flex-col">
              <div className="flex h-16 items-center gap-2 px-6 border-b border-border">
                <Image src="/rentular.png" alt="Rentular" width={36} height={36} />
                <span className="text-lg font-bold">Rentular</span>
              </div>

              <nav className="flex-1 space-y-1 px-3 py-4">
                {items.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      onClick={() => setOpen(false)}
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
            </div>
          </SheetContent>
        </Sheet>

        <Image src="/rentular.png" alt="Rentular" width={28} height={28} />
        <span className="font-semibold">Rentular</span>

        {currentItem && (
          <span className="ml-auto text-sm text-muted-foreground">
            {currentItem.label}
          </span>
        )}
      </div>
    </>
  );
}
