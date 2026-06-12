import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "OrderStack · Platform admin",
};

/**
 * Platform operator chrome. Deliberately unbranded (no restaurant theming) —
 * this is the back-office for the platform owner, not a tenant surface.
 * Auth is enforced per-page/per-action by requirePlatformAdmin().
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-baseline gap-2">
            <span className="text-base font-semibold tracking-tight">
              OrderStack
            </span>
            <span className="text-sm text-zinc-400">· Platform admin</span>
          </div>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              href="/admin"
              className="rounded-md px-3 py-1.5 font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white"
            >
              Restaurants
            </Link>
            <Link
              href="/admin/new"
              className="rounded-md px-3 py-1.5 font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white"
            >
              Onboard
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
