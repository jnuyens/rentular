import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import InvitationAcceptClient from "./InvitationAcceptClient";

export default async function InvitationAcceptPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) redirect("/login");

  const session = await auth();
  if (!session) redirect(`/login?returnUrl=/invite/accept?token=${token}`);

  return <InvitationAcceptClient token={token} />;
}
