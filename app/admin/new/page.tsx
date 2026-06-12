import { requirePlatformAdmin } from "@/lib/admin";
import { OnboardForm } from "@/components/admin/onboard-form";

export const dynamic = "force-dynamic";

export default async function OnboardRestaurantPage() {
  await requirePlatformAdmin();

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold">Onboard a restaurant</h1>
      <p className="mt-1 mb-6 text-sm text-zinc-400">
        Creates the restaurant (status <span className="font-mono">draft</span>),
        its first location, an active Main Menu, default business hours, and the
        owner&apos;s dashboard login — all in one shot.
      </p>
      <OnboardForm />
    </div>
  );
}
