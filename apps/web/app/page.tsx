import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import MarketingPage from "./(marketing)/page";

export default async function RootPage() {
  const session = await auth();
  if (session) {
    redirect("/properties");
  }
  return <MarketingPage />;
}
