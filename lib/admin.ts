import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Auth gate for /admin (platform operator back-office). Allowlist comes from
 * PLATFORM_ADMIN_EMAILS (comma-separated, case-insensitive). Admins sign in
 * via the regular /dashboard/login UI, then visit /admin.
 *
 * Returns a service-role client — admin pages operate past RLS once gated,
 * so every mutation (server action / route handler) must call this again.
 */
export async function requirePlatformAdmin() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/dashboard/login");

  const allowlist = (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const email = user.email?.toLowerCase();
  if (!email || !allowlist.includes(email)) redirect("/dashboard");

  return { user, admin: createAdminClient() };
}
