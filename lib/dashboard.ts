import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Auth + tenant context for dashboard pages. Redirects to login when signed
 * out; all subsequent queries run as the staff user, scoped by RLS.
 */
export async function requireStaff() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/dashboard/login");

  const { data: membership } = await supabase
    .from("staff_memberships")
    .select("restaurant_id, role, restaurants (id, name, branding)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) redirect("/dashboard/login?error=no-membership");

  const restaurant = membership.restaurants as unknown as {
    id: string;
    name: string;
    branding: { colors?: { primary?: string } } | null;
  };

  return { supabase, user, role: membership.role, restaurant };
}
