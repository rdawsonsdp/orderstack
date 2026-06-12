import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  MenuCategory,
  MenuModifier,
  MenuModifierGroup,
  MenuItem,
  StorefrontData,
} from "@/lib/menu-types";

export type * from "@/lib/menu-types";

/** Full menu tree for a storefront, fetched as anon (RLS: live restaurants only). */
export async function getStorefrontData(
  slug: string
): Promise<StorefrontData | null> {
  const supabase = await createClient();

  type RawGroupLink = {
    sort: number;
    modifier_groups: Omit<MenuModifierGroup, "modifiers"> & {
      modifiers: MenuModifier[];
    };
  };
  type RawItem = Omit<MenuItem, "modifier_groups"> & {
    item_modifier_groups: RawGroupLink[];
  };
  type RawCategory = {
    id: string;
    name: string;
    sort: number;
    items: RawItem[];
  };
  type RawRestaurant = {
    id: string;
    slug: string;
    name: string;
    branding: StorefrontData["restaurant"]["branding"] | null;
    platform_fee_cents: number;
    locations: Array<
      Omit<StorefrontData["location"], "tax_rate"> & { tax_rate: number | string }
    >;
    menus: Array<{ id: string; active: boolean; categories: RawCategory[] }>;
  };

  const { data: restaurant } = (await supabase
    .from("restaurants")
    .select(
      `id, slug, name, branding, platform_fee_cents,
       locations (id, name, address_line1, address_line2, city, state, postal_code,
                  phone, pickup_enabled, delivery_enabled, prep_time_min, tax_rate),
       menus (id, active,
         categories (id, name, sort,
           items (id, name, description, price_cents, image_path, sort,
                  is_available, sold_out_until,
             item_modifier_groups (sort,
               modifier_groups (id, name, min_select, max_select, required,
                 modifiers (id, name, price_delta_cents, is_available, sort))))))`
    )
    .eq("slug", slug)
    .single()) as { data: RawRestaurant | null };

  if (!restaurant) return null;
  const location = restaurant.locations?.[0];
  const menu = restaurant.menus?.find((m) => m.active);
  if (!location || !menu) return null;

  const categories: MenuCategory[] = (menu.categories ?? [])
    .map((c) => ({
      id: c.id,
      name: c.name,
      sort: c.sort,
      items: (c.items ?? [])
        .map(({ item_modifier_groups, ...item }) => ({
          ...item,
          modifier_groups: (item_modifier_groups ?? [])
            .sort((a, b) => a.sort - b.sort)
            .map((link) => ({
              ...link.modifier_groups,
              modifiers: [...link.modifier_groups.modifiers].sort(
                (a, b) => a.sort - b.sort
              ),
            })),
        }))
        .sort((a, b) => a.sort - b.sort),
    }))
    .sort((a, b) => a.sort - b.sort);

  return {
    restaurant: {
      id: restaurant.id,
      slug: restaurant.slug,
      name: restaurant.name,
      branding: restaurant.branding ?? {},
      platform_fee_cents: restaurant.platform_fee_cents,
    },
    location: { ...location, tax_rate: Number(location.tax_rate) },
    categories,
  };
}
