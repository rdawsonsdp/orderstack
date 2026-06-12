import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isOpenAt, orderingSlots } from "@/lib/hours";
import { loadHoursContext } from "@/lib/pricing-server";

/**
 * GET /api/orders/slots?locationId=<uuid> — pickup slots a diner can schedule
 * at checkout: 15-minute steps over the next 2 days, starting no sooner than
 * now + prep time. Anon-safe: hours are read via the RLS-scoped client
 * (public read on live restaurants only).
 */
export async function GET(request: NextRequest) {
  const locationId = request.nextUrl.searchParams.get("locationId");
  if (!z.guid().safeParse(locationId).success) {
    return NextResponse.json({ error: "INVALID_LOCATION_ID" }, { status: 400 });
  }

  const hours = await loadHoursContext(locationId!);
  if (!hours) {
    return NextResponse.json({ error: "LOCATION_NOT_FOUND" }, { status: 404 });
  }

  const now = new Date();
  return NextResponse.json({
    open: isOpenAt(now, hours.timeZone, hours.hours, hours.overrides),
    prepTimeMin: hours.prepTimeMin,
    timezone: hours.timeZone,
    slots: orderingSlots(
      now,
      hours.timeZone,
      hours.hours,
      hours.overrides,
      hours.prepTimeMin,
      2,
      15
    ).map((d) => d.toISOString()),
  });
}
