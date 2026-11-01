import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { capabilities } from "@/lib/env";
import { LoginScreen } from "@/components/login-screen";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  if (await getCurrentUser()) redirect("/dashboard");
  const next = sp.next && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/dashboard";
  return <LoginScreen next={next} error={sp.error ?? null} googleEnabled={capabilities().googleLogin} />;
}
