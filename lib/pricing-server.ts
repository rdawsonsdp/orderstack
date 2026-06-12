import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Cart, PricingContext } from "@/lib/pricing";

/**
 * Loads the PricingContext for a cart from the DB (as anon — RLS scopes reads
 * to live restaurants). Shared by /api/orders/price and /api/orders.
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
  restaurants: { id: string; platform_fee_cents: number };
};

export type ContextResult =
  | { ok: true; ctx: PricingContext; location: LocationRow }
  | { ok: false; error: string; status: number };

export async function loadPricingContext(cart: Cart): Promise<ContextResult> {
  const supabase = await createClient();

  const { data: location } = (await supabase
    .from("locations")
    .select(
      `id, restaurant_id, tax_rate, pickup_enabled, delivery_enabled,
       restaurants (id, platform_fee_cents)`
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
  };

  return { ok: true, ctx, location };
}
