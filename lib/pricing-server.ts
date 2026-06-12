import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Cart, PricingContext } from "@/lib/pricing";
import type { HoursRow, OverrideRow } from "@/lib/hours";

/**
 * Loads the PricingContext for a cart from the DB (as anon — RLS scopes reads
 * to live restaurants). Shared by /api/orders/price and /api/orders.
 * Coupons are the one exception: they have no anon read policy by design, so
 * codes are validated here with the service-role client.
 */

// supabase-js can't infer many-to-one join shapes without generated DB types
// (swap for `supabase gen types` output once the schema settles).
type ModRow = {
  id: string;
  name: string;
  price_delta_cents: number;
  is_available: boolean;
};
type LinkRow = {
  sort: number;
  modifier_groups: {
    id: string;
    name: string;
    min_select: number;
    max_select: number | null;
    required: boolean;
    modifiers: ModRow[];
  };
};
type ItemRow = {
  id: string;
  name: string;
  price_cents: number;
  is_available: boolean;
  sold_out_until: string | null;
  item_modifier_groups: LinkRow[];
};
type LocationRow = {
  id: string;
  restaurant_id: string;
  tax_rate: number | string;
  pickup_enabled: boolean;
  delivery_enabled: boolean;
  prep_time_min: number;
  business_hours: HoursRow[];
  hour_overrides: OverrideRow[];
  restaurants: { id: string; platform_fee_cents: number; timezone: string };
};
type CouponRow = {
  id: string;
  kind: "percent" | "fixed";
  value: number;
  min_subtotal_cents: number;
  starts_at: string | null;
  expires_at: string | null;
  max_redemptions: number | null;
  redemption_count: number;
  active: boolean;
};

export type ContextResult =
  | { ok: true; ctx: PricingContext; location: LocationRow }
  | { ok: false; error: string; message?: string; status: number };

export async function loadPricingContext(cart: Cart): Promise<ContextResult> {
  const supabase = await createClient();

  const { data: location } = (await supabase
    .from("locations")
    .select(
      `id, restaurant_id, tax_rate, pickup_enabled, delivery_enabled, prep_time_min,
       business_hours (day_of_week, opens, closes),
       hour_overrides (date, closed, opens, closes),
       restaurants (id, platform_fee_cents, timezone)`
    )
    .eq("id", cart.locationId)
    .single()) as { data: LocationRow | null };

  if (!location || !location.restaurants) {
    return { ok: false, error: "LOCATION_NOT_FOUND", status: 404 };
  }
  if (cart.type === "pickup" && !location.pickup_enabled) {
    return { ok: false, error: "PICKUP_DISABLED", status: 400 };
  }
  if (cart.type === "delivery" && !location.delivery_enabled) {
    return { ok: false, error: "DELIVERY_DISABLED", status: 400 };
  }

  // Coupon lookup runs as service role: coupons aren't anon-readable so the
  // catalog can't be enumerated. Scoped to this restaurant, exact code match.
  let coupon: PricingContext["coupon"] = null;
  if (cart.couponCode) {
    const admin = createAdminClient();
    const { data: row } = (await admin
      .from("coupons")
      .select(
        `id, kind, value, min_subtotal_cents, starts_at, expires_at,
         max_redemptions, redemption_count, active`
      )
      .eq("restaurant_id", location.restaurant_id)
      .eq("code", cart.couponCode)
      .maybeSingle()) as { data: CouponRow | null };

    const now = Date.now();
    const valid =
      row !== null &&
      row.active &&
      (!row.starts_at || Date.parse(row.starts_at) <= now) &&
      (!row.expires_at || Date.parse(row.expires_at) > now) &&
      (row.max_redemptions === null || row.redemption_count < row.max_redemptions);

    if (!valid) {
      return {
        ok: false,
        error: "COUPON_INVALID",
        message: "That code isn't valid",
        status: 422,
      };
    }
    coupon = {
      id: row.id,
      kind: row.kind,
      value: row.value,
      minSubtotalCents: row.min_subtotal_cents,
    };
  }

  const itemIds = [...new Set(cart.lines.map((l) => l.itemId))];
  const { data: items } = (await supabase
    .from("items")
    .select(
      `id, name, price_cents, is_available, sold_out_until,
       item_modifier_groups (sort,
         modifier_groups (id, name, min_select, max_select, required,
           modifiers (id, name, price_delta_cents, is_available)))`
    )
    .in("id", itemIds)) as { data: ItemRow[] | null };

  const ctx: PricingContext = {
    items: new Map(
      (items ?? []).map((item) => [
        item.id,
        {
          id: item.id,
          name: item.name,
          priceCents: item.price_cents,
          isAvailable: item.is_available,
          soldOutUntil: item.sold_out_until,
          modifierGroups: (item.item_modifier_groups ?? [])
            .sort((a, b) => a.sort - b.sort)
            .map((link) => ({
              id: link.modifier_groups.id,
              name: link.modifier_groups.name,
              minSelect: link.modifier_groups.min_select,
              maxSelect: link.modifier_groups.max_select,
              required: link.modifier_groups.required,
              modifiers: new Map(
                link.modifier_groups.modifiers.map((m) => [
                  m.id,
                  {
                    id: m.id,
                    name: m.name,
                    priceDeltaCents: m.price_delta_cents,
                    isAvailable: m.is_available,
                  },
                ])
              ),
            })),
        },
      ])
    ),
    taxRate: Number(location.tax_rate),
    platformFeeCents: location.restaurants.platform_fee_cents,
    deliveryFeeCents: 0, // Uber Direct quote lands here in Phase 3
    coupon,
  };

  return { ok: true, ctx, location };
}

/** Hours + timezone for one location, fetched as anon (RLS: live restaurants). */
export interface HoursContext {
  timeZone: string;
  prepTimeMin: number;
  hours: HoursRow[];
  overrides: OverrideRow[];
}

export async function loadHoursContext(
  locationId: string
): Promise<HoursContext | null> {
  const supabase = await createClient();

  type Row = {
    prep_time_min: number;
    business_hours: HoursRow[];
    hour_overrides: OverrideRow[];
    restaurants: { timezone: string };
  };
  const { data } = (await supabase
    .from("locations")
    .select(
      `prep_time_min,
       business_hours (day_of_week, opens, closes),
       hour_overrides (date, closed, opens, closes),
       restaurants (timezone)`
    )
    .eq("id", locationId)
    .single()) as { data: Row | null };

  if (!data || !data.restaurants) return null;
  return {
    timeZone: data.restaurants.timezone,
    prepTimeMin: data.prep_time_min,
    hours: data.business_hours ?? [],
    overrides: data.hour_overrides ?? [],
  };
}
