import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "OrderStack — Online ordering for independent restaurants",
  description:
    "Branded online ordering, kitchen dashboard, and payment transparency for independent restaurants.",
};

/** Platform landing: lists live restaurants. Replaces the starter page. */
export default async function Home() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return (
      <main className="mx-auto max-w-xl p-12">
        <h1 className="text-2xl font-bold">OrderStack</h1>
        <p className="mt-3 text-gray-600">
          Environment not configured. Set NEXT_PUBLIC_SUPABASE_URL,
          NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in your
          hosting provider, then redeploy.
        </p>
      </main>
    );
  }

  const supabase = await createClient();
  const { data: restaurants } = await supabase
    .from("restaurants")
    .select("slug, name, branding, locations (city, state)")
    .eq("status", "live")
    .order("name");

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="mx-auto max-w-3xl px-6 py-20">
        <h1 className="text-4xl font-black tracking-tight">OrderStack</h1>
        <p className="mt-3 text-lg text-white/70">
          Commission-free online ordering for independent restaurants —
          branded storefront, live kitchen dashboard, transparent payments.
        </p>

        <h2 className="mb-4 mt-14 text-sm font-bold uppercase tracking-widest text-white/50">
          Order from our restaurants
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {(restaurants ?? []).map((r) => {
            const branding = r.branding as {
              logoUrl?: string | null;
              colors?: { accent?: string };
            } | null;
            const loc = (
              r.locations as unknown as { city: string; state: string }[]
            )?.[0];
            return (
              <Link
                key={r.slug}
                href={`/${r.slug}`}
                className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/5 p-5 transition hover:bg-white/10"
              >
                {branding?.logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={branding.logoUrl}
                    alt=""
                    className="h-14 w-14 rounded-full"
                  />
                )}
                <div>
                  <p className="text-lg font-bold leading-tight">{r.name}</p>
                  {loc && (
                    <p className="text-sm text-white/60">
                      {loc.city}, {loc.state}
                    </p>
                  )}
                  <p
                    className="mt-1 text-sm font-semibold"
                    style={{ color: branding?.colors?.accent ?? "#fff" }}
                  >
                    Order online →
                  </p>
                </div>
              </Link>
            );
          })}
          {(restaurants ?? []).length === 0 && (
            <p className="text-white/50">No restaurants live yet.</p>
          )}
        </div>

        <p className="mt-16 text-sm text-white/40">
          Restaurant owner?{" "}
          <Link href="/dashboard/login" className="underline">
            Sign in to your dashboard
          </Link>
        </p>
      </div>
    </main>
  );
}
