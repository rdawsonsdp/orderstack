import { requireStaff } from "@/lib/dashboard";
import {
  CouponsManager,
  type ManagedCoupon,
} from "@/components/dashboard/coupons-manager";

export const dynamic = "force-dynamic";

/**
 * Server shell: auth + initial coupon list, then hand off to the client
 * manager (mutations go through the RLS browser client).
 */
export default async function CouponsPage() {
  const { supabase, restaurant } = await requireStaff();

  const { data } = await supabase
    .from("coupons")
    .select(
      `id, code, kind, value, min_subtotal_cents, starts_at, expires_at,
       max_redemptions, redemption_count, active, created_at`
    )
    .eq("restaurant_id", restaurant.id)
    .order("created_at", { ascending: false });

  return (
    <CouponsManager
      restaurantId={restaurant.id}
      restaurantName={restaurant.name}
      initialCoupons={(data ?? []) as ManagedCoupon[]}
    />
  );
}
