"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { onboardRestaurant, type OnboardState } from "@/app/admin/actions";

// Keep in sync with the server action / DB check constraint.
const SLUG_RE = /^[a-z0-9](-?[a-z0-9])*$/;

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

// Render Monday-first; values are DB day_of_week (0 = Sunday).
const DAYS: { day: number; label: string }[] = [
  { day: 1, label: "Monday" },
  { day: 2, label: "Tuesday" },
  { day: 3, label: "Wednesday" },
  { day: 4, label: "Thursday" },
  { day: 5, label: "Friday" },
  { day: 6, label: "Saturday" },
  { day: 0, label: "Sunday" },
];

const initialState: OnboardState = { ok: false };

const inputClass =
  "w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-400 focus:outline-none";
const labelClass = "mb-1 block text-xs font-medium text-zinc-400";

function Field({
  label,
  error,
  children,
  className,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className={labelClass}>{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="border-b border-zinc-800 pb-2 text-sm font-semibold text-zinc-200">
      {children}
    </h2>
  );
}

export function OnboardForm() {
  const [state, formAction, pending] = useActionState(
    onboardRestaurant,
    initialState
  );
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [closedDays, setClosedDays] = useState<Set<number>>(new Set());

  const errors = state.errors ?? {};

  if (state.ok && state.result) {
    const { slug: createdSlug, restaurantName, ownerEmail, ownerPassword } =
      state.result;
    return (
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-6">
        <h2 className="text-lg font-semibold text-emerald-400">
          {restaurantName} is onboarded
        </h2>
        <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <strong>Save these credentials now.</strong> The password is shown
          only once and cannot be retrieved later.
        </div>
        <dl className="mt-5 space-y-3 text-sm">
          <div>
            <dt className="text-xs font-medium text-zinc-400">Storefront</dt>
            <dd>
              <Link
                href={`/${createdSlug}`}
                target="_blank"
                className="font-mono text-zinc-100 underline hover:text-white"
              >
                /{createdSlug}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-zinc-400">
              Owner dashboard
            </dt>
            <dd>
              <Link
                href="/dashboard"
                target="_blank"
                className="font-mono text-zinc-100 underline hover:text-white"
              >
                /dashboard
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-zinc-400">Owner email</dt>
            <dd className="font-mono text-zinc-100">{ownerEmail}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-zinc-400">
              Owner password (shown once)
            </dt>
            <dd className="font-mono text-base text-zinc-100">
              {ownerPassword}
            </dd>
          </div>
        </dl>
        <div className="mt-6 flex gap-3 text-sm">
          <Link
            href="/admin"
            className="rounded-md bg-zinc-100 px-4 py-2 font-semibold text-zinc-900 hover:bg-white"
          >
            Back to restaurants
          </Link>
          <Link
            href="/admin/new"
            className="rounded-md border border-zinc-700 px-4 py-2 font-medium text-zinc-300 hover:bg-zinc-800"
          >
            Onboard another
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-8">
      {errors._form && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {errors._form}
        </div>
      )}

      {/* Restaurant -------------------------------------------------------- */}
      <section className="space-y-4">
        <SectionTitle>Restaurant</SectionTitle>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name" error={errors.name}>
            <input
              name="name"
              required
              placeholder="Dat Donut"
              className={inputClass}
              onChange={(e) => {
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
            />
          </Field>
          <Field label="Slug (URL: /{slug})" error={errors.slug}>
            <input
              name="slug"
              required
              value={slug}
              placeholder="dat-donut"
              className={`${inputClass} font-mono`}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
            />
            {slug && !SLUG_RE.test(slug) && !errors.slug && (
              <p className="mt-1 text-xs text-amber-400">
                Lowercase letters, digits, single hyphens only.
              </p>
            )}
          </Field>
          <Field label="Timezone" error={errors.timezone}>
            <input
              name="timezone"
              defaultValue="America/Chicago"
              className={`${inputClass} font-mono`}
            />
          </Field>
          <Field
            label="Platform fee (cents, diner-paid)"
            error={errors.platform_fee_cents}
          >
            <input
              name="platform_fee_cents"
              type="number"
              min={0}
              step={1}
              defaultValue={129}
              className={inputClass}
            />
          </Field>
        </div>
      </section>

      {/* Location ---------------------------------------------------------- */}
      <section className="space-y-4">
        <SectionTitle>Location</SectionTitle>
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Address line 1"
            error={errors.address_line1}
            className="col-span-2"
          >
            <input
              name="address_line1"
              required
              placeholder="8249 S Cottage Grove Ave"
              className={inputClass}
            />
          </Field>
          <Field
            label="Address line 2 (optional)"
            error={errors.address_line2}
            className="col-span-2"
          >
            <input name="address_line2" className={inputClass} />
          </Field>
          <Field label="City" error={errors.city}>
            <input
              name="city"
              required
              placeholder="Chicago"
              className={inputClass}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="State" error={errors.state}>
              <input name="state" required placeholder="IL" className={inputClass} />
            </Field>
            <Field label="Postal code" error={errors.postal_code}>
              <input
                name="postal_code"
                required
                placeholder="60619"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Phone (optional)" error={errors.phone}>
            <input
              name="phone"
              type="tel"
              placeholder="(773) 555-0148"
              className={inputClass}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Prep time (min)" error={errors.prep_time_min}>
              <input
                name="prep_time_min"
                type="number"
                min={0}
                step={1}
                defaultValue={20}
                className={inputClass}
              />
            </Field>
            <Field label="Tax rate" error={errors.tax_rate}>
              <input
                name="tax_rate"
                defaultValue="0.1075"
                className={`${inputClass} font-mono`}
              />
            </Field>
          </div>
          <Field label="Alert email (optional)" error={errors.alert_email}>
            <input name="alert_email" type="email" className={inputClass} />
          </Field>
          <Field label="Alert phone (optional)" error={errors.alert_phone}>
            <input name="alert_phone" type="tel" className={inputClass} />
          </Field>
        </div>
        <p className="text-xs text-zinc-500">
          Pickup is enabled by default; delivery stays off until configured
          later.
        </p>
      </section>

      {/* Hours -------------------------------------------------------------- */}
      <section className="space-y-4">
        <SectionTitle>Business hours</SectionTitle>
        <div className="overflow-hidden rounded-md border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Day</th>
                <th className="px-3 py-2 text-left font-medium">Opens</th>
                <th className="px-3 py-2 text-left font-medium">Closes</th>
                <th className="px-3 py-2 text-left font-medium">Closed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {DAYS.map(({ day, label }) => {
                const closed = closedDays.has(day);
                return (
                  <tr key={day}>
                    <td className="px-3 py-2 text-zinc-300">
                      {label}
                      {errors[`hours_${day}`] && (
                        <p className="text-xs text-red-400">
                          {errors[`hours_${day}`]}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="time"
                        name={`hours_open_${day}`}
                        defaultValue="11:00"
                        disabled={closed}
                        className={`${inputClass} w-32 disabled:opacity-40`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="time"
                        name={`hours_close_${day}`}
                        defaultValue="20:00"
                        disabled={closed}
                        className={`${inputClass} w-32 disabled:opacity-40`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        name={`hours_closed_${day}`}
                        checked={closed}
                        onChange={(e) => {
                          setClosedDays((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(day);
                            else next.delete(day);
                            return next;
                          });
                        }}
                        className="h-4 w-4 accent-zinc-300"
                        aria-label={`${label} closed`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Owner --------------------------------------------------------------- */}
      <section className="space-y-4">
        <SectionTitle>Owner login</SectionTitle>
        <Field label="Owner email" error={errors.owner_email} className="max-w-md">
          <input
            name="owner_email"
            type="email"
            required
            placeholder="owner@restaurant.com"
            className={inputClass}
          />
        </Field>
        <p className="text-xs text-zinc-500">
          A password is generated automatically and shown once on the success
          screen. The owner signs in at /dashboard/login.
        </p>
      </section>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-100 px-5 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-white disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create restaurant"}
      </button>
    </form>
  );
}
