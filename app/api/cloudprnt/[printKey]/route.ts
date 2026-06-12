import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { receiptText, RECEIPT_ORDER_SELECT, type ReceiptOrder } from "@/lib/receipt";

/**
 * Star CloudPRNT server. Configure the kitchen printer's CloudPRNT URL to
 *   https://<host>/api/cloudprnt/{locations.print_key}
 * The printer then drives the conversation:
 *   POST  → "anything to print?" → { jobReady, jobToken, mediaTypes }
 *   GET   ?token= → the job body (text/plain ticket)
 *   DELETE ?token=&code= → print result; job marked done/failed
 *
 * NOTE: written to the CloudPRNT spec but not yet exercised against real
 * hardware — verify with a printer before relying on it in a kitchen.
 */

async function locationForKey(printKey: string) {
  if (!/^[0-9a-f-]{36}$/i.test(printKey)) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("locations")
    .select("id, restaurant_id")
    .eq("print_key", printKey)
    .single();
  return data;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ printKey: string }> }
) {
  const { printKey } = await params;
  const location = await locationForKey(printKey);
  if (!location) {
    return NextResponse.json({ error: "UNKNOWN_PRINTER" }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data: job } = await admin
    .from("print_jobs")
    .select("id")
    .eq("restaurant_id", location.restaurant_id)
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!job) {
    return NextResponse.json({ jobReady: false });
  }
  return NextResponse.json({
    jobReady: true,
    jobToken: job.id,
    mediaTypes: ["text/plain"],
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ printKey: string }> }
) {
  const { printKey } = await params;
  const location = await locationForKey(printKey);
  const token = request.nextUrl.searchParams.get("token");
  if (!location || !token || !/^[0-9a-f-]{36}$/i.test(token)) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: job } = await admin
    .from("print_jobs")
    .select("id, order_id")
    .eq("id", token)
    .eq("restaurant_id", location.restaurant_id)
    .single();
  if (!job) {
    return NextResponse.json({ error: "JOB_NOT_FOUND" }, { status: 404 });
  }

  const { data: order } = (await admin
    .from("orders")
    .select(RECEIPT_ORDER_SELECT)
    .eq("id", job.order_id)
    .single()) as { data: ReceiptOrder | null };
  if (!order) {
    await admin.from("print_jobs").update({ status: "failed" }).eq("id", job.id);
    return NextResponse.json({ error: "ORDER_GONE" }, { status: 410 });
  }

  await admin.from("print_jobs").update({ status: "printing" }).eq("id", job.id);

  return new NextResponse(receiptText(order) + "\n\n\n", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ printKey: string }> }
) {
  const { printKey } = await params;
  const location = await locationForKey(printKey);
  const token = request.nextUrl.searchParams.get("token");
  const code = request.nextUrl.searchParams.get("code") ?? "";
  if (!location || !token || !/^[0-9a-f-]{36}$/i.test(token)) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  const ok = code.toUpperCase() === "OK" || code.startsWith("2");
  const admin = createAdminClient();
  await admin
    .from("print_jobs")
    .update({
      status: ok ? "done" : "failed",
      printed_at: ok ? new Date().toISOString() : null,
    })
    .eq("id", token)
    .eq("restaurant_id", location.restaurant_id);

  return NextResponse.json({ received: true });
}
