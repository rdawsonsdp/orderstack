/**
 * Tenant resolution: every storefront request maps a hostname to a restaurant.
 *
 *   {slug}.orderstack.app   → slug lookup
 *   order.datdonut.com      → custom_domain lookup (Phase 2, Vercel domain API)
 *   localhost / preview     → path-based: /{slug}/...
 */

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "orderstack.app";

export type TenantRef =
  | { by: "slug"; slug: string }
  | { by: "custom_domain"; domain: string }
  | null;

/** Pure hostname → tenant reference. Returns null for the apex/admin host. */
export function resolveTenantFromHost(host: string): TenantRef {
  const hostname = host.split(":")[0].toLowerCase();

  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".vercel.app")
  ) {
    return null; // path-based routing in dev/preview
  }

  if (hostname === ROOT_DOMAIN || hostname === `www.${ROOT_DOMAIN}`) {
    return null; // platform landing/admin
  }

  if (hostname.endsWith(`.${ROOT_DOMAIN}`)) {
    const slug = hostname.slice(0, -(ROOT_DOMAIN.length + 1));
    if (slug && !slug.includes(".")) return { by: "slug", slug };
    return null;
  }

  return { by: "custom_domain", domain: hostname };
}
