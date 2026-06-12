/** Client-safe menu types + formatting (no server imports). */

export interface MenuModifier {
  id: string;
  name: string;
  price_delta_cents: number;
  is_available: boolean;
  sort: number;
}

export interface MenuModifierGroup {
  id: string;
  name: string;
  min_select: number;
  max_select: number | null;
  required: boolean;
  modifiers: MenuModifier[];
}

export interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  image_path: string | null;
  sort: number;
  is_available: boolean;
  sold_out_until: string | null;
  modifier_groups: MenuModifierGroup[];
}

export interface MenuCategory {
  id: string;
  name: string;
  sort: number;
  items: MenuItem[];
}

export interface StorefrontData {
  restaurant: {
    id: string;
    slug: string;
    name: string;
    branding: {
      colors?: { primary?: string; accent?: string; background?: string };
      logoUrl?: string | null;
      heroUrl?: string | null;
    };
    platform_fee_cents: number;
  };
  location: {
    id: string;
    name: string;
    address_line1: string;
    address_line2: string | null;
    city: string;
    state: string;
    postal_code: string;
    phone: string | null;
    pickup_enabled: boolean;
    delivery_enabled: boolean;
    prep_time_min: number;
    tax_rate: number;
  };
  categories: MenuCategory[];
}

/** Storage path → public URL (menu-images bucket). Passes through full URLs. */
export function menuImageUrl(imagePath: string | null): string | null {
  if (!imagePath) return null;
  if (imagePath.startsWith("http")) return imagePath;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/menu-images/${imagePath}`;
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}
