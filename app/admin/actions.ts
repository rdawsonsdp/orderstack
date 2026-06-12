"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/admin";

// "use server" files may only export async functions, so the slug regex is
// duplicated in components/admin/onboard-form.tsx. Matches the DB check.
const SLUG_RE = /^[a-z0-9](-?[a-z0-9])*$/;

// ---------------------------------------------------------------------------
// Restaurant row mutations (list page)
// ---------------------------------------------------------------------------

/** Operator-level lifecycle moves; richer than the order state machine needs. */
const STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ["onboarding"],
  onboarding: ["live"],
  live: ["paused"],
  paused: ["live"],
};

export type ActionResult = { ok: boolean; error?: string };

export async function updateRestaurantStatus(
  restaurantId: string,
  toStatus: string
): Promise<ActionResult> {
  const { admin } = await requirePlatformAdmin();

  const { data: restaurant } = await admin
    .from("restaurants")
    .select("id, status")
    .eq("id", restaurantId)
    .single();
  if (!restaurant) return { ok: false, error: "Restaurant not found." };

  const allowed = STATUS_TRANSITIONS[restaurant.status] ?? [];
  if (!allowed.includes(toStatus)) {
    return {
      ok: false,
      error: `Cannot move ${restaurant.status} → ${toStatus}.`,
    };
  }

  const { error } = await admin
    .from("restaurants")
    .update({ status: toStatus })
    .eq("id", restaurantId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}

export async function updateRestaurantFee(
  restaurantId: string,
  feeCents: number
): Promise<ActionResult> {
  const { admin } = await requirePlatformAdmin();

  if (!Number.isInteger(feeCents) || feeCents < 0 || feeCents > 100_000) {
    return { ok: false, error: "Fee must be a whole number of cents ≥ 0." };
  }

  const { error } = await admin
    .from("restaurants")
    .update({ platform_fee_cents: feeCents })
    .eq("id", restaurantId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Onboarding (one-shot restaurant + location + menu + hours + owner login)
// ---------------------------------------------------------------------------

export type OnboardState = {
  ok: boolean;
  /** Field-keyed inline errors; "_form" for cross-cutting failures. */
  errors?: Record<string, string>;
  result?: {
    slug: string;
    restaurantName: string;
    ownerEmail: string;
    ownerPassword: string;
  };
};

const DAY_KEYS = ["0", "1", "2", "3", "4", "5", "6"]; // day_of_week, 0 = Sunday
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onboardRestaurant(
  _prev: OnboardState,
  formData: FormData
): Promise<OnboardState> {
  const { admin } = await requirePlatformAdmin();

  const str = (key: string) => (formData.get(key) ?? "").toString().trim();
  const errors: Record<string, string> = {};

  // -- restaurant ------------------------------------------------------------
  const name = str("name");
  const slug = str("slug");
  const timezone = str("timezone") || "America/Chicago";
  const feeRaw = str("platform_fee_cents") || "129";
  const feeCents = Number(feeRaw);

  if (!name) errors.name = "Name is required.";
  if (!slug) errors.slug = "Slug is required.";
  else if (!SLUG_RE.test(slug)) {
    errors.slug =
      "Lowercase letters, digits, and single hyphens only (e.g. dat-donut).";
  }
  if (!Number.isInteger(feeCents) || feeCents < 0) {
    errors.platform_fee_cents = "Whole number of cents, ≥ 0.";
  }

  // -- location ---------------------------------------------------------------
  const addressLine1 = str("address_line1");
  const addressLine2 = str("address_line2");
  const city = str("city");
  const state = str("state");
  const postalCode = str("postal_code");
  const phone = str("phone");
  const prepRaw = str("prep_time_min") || "20";
  const prepTimeMin = Number(prepRaw);
  const taxRaw = str("tax_rate") || "0.1075";
  const taxRate = Number(taxRaw);
  const alertEmail = str("alert_email");
  const alertPhone = str("alert_phone");

  if (!addressLine1) errors.address_line1 = "Street address is required.";
  if (!city) errors.city = "City is required.";
  if (!state) errors.state = "State is required.";
  if (!postalCode) errors.postal_code = "Postal code is required.";
  if (!Number.isInteger(prepTimeMin) || prepTimeMin < 0) {
    errors.prep_time_min = "Whole number of minutes, ≥ 0.";
  }
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate >= 1) {
    errors.tax_rate = "Decimal rate between 0 and 1 (e.g. 0.1075).";
  }
  if (alertEmail && !EMAIL_RE.test(alertEmail)) {
    errors.alert_email = "Not a valid email address.";
  }

  // -- hours -------------------------------------------------------------------
  const hours: { day_of_week: number; opens: string; closes: string }[] = [];
  for (const day of DAY_KEYS) {
    if (formData.get(`hours_closed_${day}`)) continue;
    const opens = str(`hours_open_${day}`);
    const closes = str(`hours_close_${day}`);
    if (!TIME_RE.test(opens) || !TIME_RE.test(closes)) {
      errors[`hours_${day}`] = "Enter open and close times (HH:MM).";
      continue;
    }
    if (opens >= closes) {
      errors[`hours_${day}`] = "Open time must be before close time.";
      continue;
    }
    hours.push({ day_of_week: Number(day), opens, closes });
  }

  // -- owner --------------------------------------------------------------------
  const ownerEmail = str("owner_email").toLowerCase();
  if (!ownerEmail) errors.owner_email = "Owner email is required.";
  else if (!EMAIL_RE.test(ownerEmail)) {
    errors.owner_email = "Not a valid email address.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  // Slug must be free before we start creating rows.
  const { data: existing } = await admin
    .from("restaurants")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (existing) {
    return { ok: false, errors: { slug: `Slug "${slug}" is already taken.` } };
  }

  // -- create, with best-effort rollback on failure ------------------------------
  const { data: restaurant, error: restaurantError } = await admin
    .from("restaurants")
    .insert({
      name,
      slug,
      timezone,
      status: "draft",
      platform_fee_cents: feeCents,
    })
    .select("id")
    .single();
  if (restaurantError || !restaurant) {
    return {
      ok: false,
      errors: {
        _form: `Could not create restaurant: ${restaurantError?.message}`,
      },
    };
  }

  // Cascade delete cleans up location/menu/hours with the restaurant.
  const rollback = () => admin.from("restaurants").delete().eq("id", restaurant.id);

  const { data: location, error: locationError } = await admin
    .from("locations")
    .insert({
      restaurant_id: restaurant.id,
      name: "Main",
      address_line1: addressLine1,
      address_line2: addressLine2 || null,
      city,
      state,
      postal_code: postalCode,
      phone: phone || null,
      pickup_enabled: true,
      delivery_enabled: false,
      prep_time_min: prepTimeMin,
      tax_rate: taxRate,
      ...(alertEmail ? { alert_email: alertEmail } : {}),
      ...(alertPhone ? { alert_phone: alertPhone } : {}),
    })
    .select("id")
    .single();
  if (locationError || !location) {
    await rollback();
    return {
      ok: false,
      errors: { _form: `Could not create location: ${locationError?.message}` },
    };
  }

  const { error: menuError } = await admin
    .from("menus")
    .insert({ restaurant_id: restaurant.id, name: "Main Menu", active: true });
  if (menuError) {
    await rollback();
    return {
      ok: false,
      errors: { _form: `Could not create menu: ${menuError.message}` },
    };
  }

  if (hours.length > 0) {
    const { error: hoursError } = await admin
      .from("business_hours")
      .insert(hours.map((h) => ({ ...h, location_id: location.id })));
    if (hoursError) {
      await rollback();
      return {
        ok: false,
        errors: { _form: `Could not create hours: ${hoursError.message}` },
      };
    }
  }

  // Owner login via service-role auth REST (matches scripts/create-staff.mjs —
  // supabase-js admin auth isn't used here for the same reason as that script).
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const authHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };

  const ownerPassword = `${randomUUID().slice(0, 13)}${randomUUID().slice(0, 5)}`;

  const userRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      email: ownerEmail,
      password: ownerPassword,
      email_confirm: true,
    }),
  });
  const user = (await userRes.json().catch(() => null)) as {
    id?: string;
    msg?: string;
    message?: string;
  } | null;
  if (!userRes.ok || !user?.id) {
    await rollback();
    const detail = user?.msg ?? user?.message ?? `HTTP ${userRes.status}`;
    return {
      ok: false,
      errors: {
        owner_email: `Could not create owner login: ${detail}. If this email already has an account, use scripts/create-staff.mjs to attach it instead.`,
      },
    };
  }

  const { error: membershipError } = await admin
    .from("staff_memberships")
    .insert({ user_id: user.id, restaurant_id: restaurant.id, role: "owner" });
  if (membershipError) {
    // Undo the auth user too so a retry with the same email works.
    await fetch(`${supabaseUrl}/auth/v1/admin/users/${user.id}`, {
      method: "DELETE",
      headers: authHeaders,
    }).catch(() => {});
    await rollback();
    return {
      ok: false,
      errors: {
        _form: `Could not create owner membership: ${membershipError.message}`,
      },
    };
  }

  revalidatePath("/admin");
  return {
    ok: true,
    result: { slug, restaurantName: name, ownerEmail, ownerPassword },
  };
}
