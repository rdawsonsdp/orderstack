import { NextRequest, NextResponse } from "next/server";
import { resolveTenantFromHost } from "@/lib/tenant";
import { updateSession } from "@/lib/supabase/proxy-session";

/**
 * Tenant routing (Next.js 16 proxy, formerly middleware):
 * {slug}.orderstack.app/menu → rewritten to /{slug}/menu so one app
 * serves every storefront. Dashboard/admin requests refresh the staff
 * auth session; api paths pass through.
 */
export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/dashboard") || pathname.startsWith("/admin")) {
    return updateSession(request);
  }

  if (pathname.startsWith("/api") || pathname.startsWith("/_next")) {
    return NextResponse.next();
  }

  const tenant = resolveTenantFromHost(request.headers.get("host") ?? "");

  if (tenant?.by === "slug") {
    const url = request.nextUrl.clone();
    url.pathname = `/${tenant.slug}${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(url);
  }

  // Custom domains (Phase 2): look up custom_domain → slug, then rewrite.
  // Dev/preview and the apex domain use path-based routing as-is.
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
