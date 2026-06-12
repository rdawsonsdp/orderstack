import Link from "next/link";
import { requireStaff } from "@/lib/dashboard";
import { SignOutButton } from "@/components/dashboard/sign-out";

/**
 * Dashboard chrome, branded per restaurant from restaurants.branding —
 * the same JSONB that themes the storefront, so one schema drives both.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { restaurant } = await requireStaff();
  const branding = (restaurant.branding ?? {}) as {
    logoUrl?: string | null;
    heroUrl?: string | null;
    colors?: { primary?: string; accent?: string };
  };
  const primary = branding.colors?.primary ?? "#111827";
  const accent = branding.colors?.accent ?? "#374151";

  return (
    <div
      className="min-h-screen bg-gray-50"
      style={{ "--brand": primary, "--accent": accent } as React.CSSProperties}
    >
      <header
        className="relative border-b-8 bg-cover bg-center text-white"
        style={{
          backgroundColor: primary,
          backgroundImage: branding.heroUrl
            ? `linear-gradient(to right, ${primary}f2 0%, ${primary}cc 45%, ${primary}55 100%), url(${branding.heroUrl})`
            : undefined,
          borderBottomColor: accent,
        }}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-4">
            {branding.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={branding.logoUrl}
                alt={`${restaurant.name} logo`}
                className="h-20 w-20 rounded-full shadow-lg ring-2 ring-white/30"
              />
            )}
            <div>
              <p className="text-3xl font-extrabold leading-tight drop-shadow">
                {restaurant.name}
              </p>
              <p className="text-sm font-medium text-white/70">
                OrderStack kitchen dashboard
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <nav className="flex gap-2 text-lg">
              <Link
                href="/dashboard"
                className="rounded-lg bg-white/15 px-5 py-3 font-bold backdrop-blur-sm hover:bg-white/25"
              >
                Orders
              </Link>
              <Link
                href="/dashboard/menu"
                className="rounded-lg bg-white/15 px-5 py-3 font-bold backdrop-blur-sm hover:bg-white/25"
              >
                Menu
              </Link>
            </nav>
            <SignOutButton />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
