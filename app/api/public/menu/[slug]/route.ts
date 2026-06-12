import { NextRequest, NextResponse } from "next/server";
import { getStorefrontData } from "@/lib/menu";
import { menuImageUrl } from "@/lib/menu-types";

/**
 * Public menu feed for external websites (Integration Option B): Rob's
 * existing client sites (acsoulfood.com, Pepe's, …) render their menu pages
 * from this endpoint, so the dashboard is the single source of truth — 86 an
 * item and it disappears from the marketing site too.
 *
 *   GET /api/public/menu/ac-soul-food
 *
 * CORS-open (it's the same data the public storefront serves) and CDN-cached
 * for 60s.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const data = await getStorefrontData(slug);
  if (!data) {
    return NextResponse.json(
      { error: "RESTAURANT_NOT_FOUND" },
      { status: 404, headers: CORS }
    );
  }

  const { restaurant, location, categories } = data;
  const now = new Date();

  return NextResponse.json(
    {
      restaurant: {
        name: restaurant.name,
        slug: restaurant.slug,
        logoUrl: restaurant.branding.logoUrl ?? null,
        orderUrl: `${request.nextUrl.origin}/${restaurant.slug}`,
      },
      location: {
        address: [
          location.address_line1,
          location.address_line2,
          `${location.city}, ${location.state} ${location.postal_code}`,
        ]
          .filter(Boolean)
          .join(", "),
        phone: location.phone,
      },
      categories: categories.map((c) => ({
        name: c.name,
        items: c.items
          .filter(
            (i) =>
              i.is_available &&
              (!i.sold_out_until || new Date(i.sold_out_until) <= now)
          )
          .map((i) => ({
            name: i.name,
            description: i.description,
            priceCents: i.price_cents,
            price: `$${(i.price_cents / 100).toFixed(2)}`,
            imageUrl: menuImageUrl(i.image_path),
            hasOptions: i.modifier_groups.length > 0,
          })),
      })),
    },
    {
      headers: {
        ...CORS,
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    }
  );
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
