import { notFound } from "next/navigation";
import { getStorefrontData } from "@/lib/menu";
import { Storefront } from "@/components/storefront/storefront";

/**
 * Storefront entry — resolved via subdomain rewrite (proxy.ts) or /{slug} in dev.
 * Server component fetches the menu tree as anon (RLS: live restaurants only);
 * all interactivity lives in <Storefront>.
 */
export default async function StorefrontPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const data = await getStorefrontData(tenant);
  if (!data) notFound();

  return <Storefront data={data} />;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const data = await getStorefrontData(tenant);
  if (!data) return {};
  const { restaurant, location } = data;
  return {
    title: `${restaurant.name} — ${location.city}, ${location.state} (Order Online)`,
    description: `Order pickup online from ${restaurant.name}, ${location.address_line1}, ${location.city}.`,
  };
}
