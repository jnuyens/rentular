import {
  Building2,
  Users,
  FileText,
  CreditCard,
  TrendingUp,
  Settings,
  LogOut,
} from "lucide-react";
import { auth, signOut } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import LanguageSwitcher from "@/components/LanguageSwitcher";

const navigationItems = [
  { key: "properties" as const, href: "/properties", icon: Building2 },
  { key: "tenants" as const, href: "/tenants", icon: Users },
  { key: "leases" as const, href: "/leases", icon: FileText },
  { key: "payments" as const, href: "/payments", icon: CreditCard },
  { key: "indexation" as const, href: "/indexation", icon: TrendingUp },
  { key: "settings" as const, href: "/settings", icon: Settings },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  const t = await getTranslations("nav");

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--background))]">
        <div className="flex h-16 items-center gap-2 px-6">
          <Building2 className="h-7 w-7 text-[hsl(var(--primary))]" />
          <span className="text-xl font-bold">Rentular</span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {navigationItems.map((item) => (
            <a
              key={item.key}
              href={item.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
            >
              <item.icon className="h-5 w-5" />
              {t(item.key)}
            </a>
          ))}
        </nav>

        <div className="border-t border-[hsl(var(--border))] p-4">
          <div className="mb-3">
            <LanguageSwitcher />
          </div>
          <div className="flex items-center gap-3">
            {session.user?.image && (
              <img
                src={session.user.image}
                alt=""
                className="h-8 w-8 rounded-full"
              />
            )}
            <div className="flex-1 truncate">
              <p className="text-sm font-medium">{session.user?.name}</p>
              <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">
                {session.user?.email}
              </p>
            </div>
            <form
              action={async () => {
                "use server";
                await signOut();
              }}
            >
              <button
                type="submit"
                className="rounded-lg p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-[hsl(var(--muted))] p-8">
        {children}
      </main>
    </div>
  );
}
