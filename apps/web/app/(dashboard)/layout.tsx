import Image from "next/image";
import { cookies } from "next/headers";
import { auth, signOut } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import SupportChat from "@/components/SupportChat";
import DashboardSidebar from "@/components/DashboardSidebar";
import MobileNav from "@/components/MobileNav";

const navigationItems = [
  { key: "properties" as const, href: "/properties", iconName: "Building2" as const },
  { key: "tenants" as const, href: "/tenants", iconName: "Users" as const },
  { key: "leases" as const, href: "/leases", iconName: "FileText" as const },
  { key: "payments" as const, href: "/payments", iconName: "CreditCard" as const },
  { key: "indexation" as const, href: "/indexation", iconName: "TrendingUp" as const },
  { key: "communications" as const, href: "/communications", iconName: "MessageSquare" as const },
  { key: "maintenance" as const, href: "/maintenance", iconName: "Wrench" as const },
  { key: "settings" as const, href: "/settings", iconName: "Settings" as const },
  { key: "import" as const, href: "/import", iconName: "Download" as const },
];

// Role-based nav filtering per D-09 and UI-SPEC sidebar table
// Maps nav key -> roles that CANNOT see it
const NAV_VISIBILITY: Record<string, string[]> = {
  settings: ["co_owner", "manager", "accountant", "viewer"], // owner only
  import: ["co_owner", "manager", "accountant", "viewer"], // owner only
  tenants: ["accountant"],
  leases: ["accountant"],
  indexation: ["accountant"],
  maintenance: ["accountant"],
};

const ROLE_PRIORITY: Record<string, number> = {
  owner: 5,
  co_owner: 4,
  manager: 3,
  accountant: 2,
  viewer: 1,
};

async function handleSignOut() {
  "use server";
  await signOut();
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  const t = await getTranslations("nav");

  // Determine user's highest role across all accessible properties
  let highestRole = "owner"; // Default to owner for users who own properties directly
  try {
    const cookieStore = await cookies();
    const cookieHeader = cookieStore.toString();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
    const res = await fetch(`${apiUrl}/api/v1/properties`, {
      headers: { Cookie: cookieHeader },
      cache: "no-store",
    });
    if (res.ok) {
      const json = await res.json();
      const properties = json.data || [];
      if (properties.length > 0) {
        // Find the highest role across all properties
        highestRole = "viewer"; // Start from lowest if properties exist
        for (const prop of properties) {
          const propRole = prop.userRole as string;
          if ((ROLE_PRIORITY[propRole] || 0) > (ROLE_PRIORITY[highestRole] || 0)) {
            highestRole = propRole;
          }
        }
      }
    }
  } catch {
    // Default to owner if API unreachable -- show all nav items
  }

  const filteredNav = navigationItems.filter((item) => {
    const blocked = NAV_VISIBILITY[item.key];
    if (!blocked) return true; // visible to all roles
    return !blocked.includes(highestRole);
  });

  const navItems = filteredNav.map((item) => ({
    key: item.key,
    href: item.href,
    iconName: item.iconName,
    label: t(item.key),
  }));

  return (
    <div className="flex h-screen">
      <DashboardSidebar
        items={navItems}
        userName={session.user?.name}
        userEmail={session.user?.email}
        userImage={session.user?.image}
        signOutAction={handleSignOut}
      />
      <MobileNav
        items={navItems}
        userName={session.user?.name}
        userEmail={session.user?.email}
        signOutAction={handleSignOut}
      />

      {/* Main content */}
      <main className="relative flex-1 overflow-auto bg-muted pt-14 md:pt-0 p-4 md:p-8">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.02]">
          <Image src="/rentular.png" alt="" width={400} height={400} className="select-none" />
        </div>
        <div className="relative">{children}</div>
      </main>

      <SupportChat />
    </div>
  );
}
