import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import MarketingPage from "./(marketing)/page";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  const session = await auth();
  if (session) {
    redirect("/properties");
  }
  return <MarketingPage />;
}
