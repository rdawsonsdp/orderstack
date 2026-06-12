import "server-only";

/**
 * Notification layer. Transports are chosen by env at send time:
 *   RESEND_API_KEY set   → email via Resend, else console.log (dev)
 *   TWILIO_* set         → SMS via Twilio, else console.log (dev)
 * Senders must never throw — a failed notification must not fail an order.
 * Implementations live in ./transports; this module is the only import
 * surface the rest of the app uses.
 */

export interface OrderSummaryForNotice {
  orderNumber: number;
  restaurantName: string;
  totalCents: number;
  trackingUrl: string;
  items: Array<{ qty: number; name: string }>;
  scheduledFor: string | null;
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const { emailTransport } = await import("./transports");
  await emailTransport(params).catch((err) =>
    console.error("[notify] email failed:", (err as Error).message)
  );
}

export async function sendSms(params: {
  to: string;
  body: string;
}): Promise<void> {
  const { smsTransport } = await import("./transports");
  await smsTransport(params).catch((err) =>
    console.error("[notify] sms failed:", (err as Error).message)
  );
}

/** Diner: order confirmed (after payment lands). */
export async function notifyDinerOrderPlaced(
  email: string,
  phone: string | null,
  order: OrderSummaryForNotice
): Promise<void> {
  const itemsText = order.items.map((i) => `${i.qty}× ${i.name}`).join(", ");
  await sendEmail({
    to: email,
    subject: `Order #${order.orderNumber} confirmed — ${order.restaurantName}`,
    html: `<p>Thanks! ${order.restaurantName} received your order.</p>
<p><strong>${itemsText}</strong> · $${(order.totalCents / 100).toFixed(2)}</p>
${order.scheduledFor ? `<p>Scheduled for ${new Date(order.scheduledFor).toLocaleString("en-US")}</p>` : ""}
<p><a href="${order.trackingUrl}">Track your order</a></p>`,
  });
  if (phone) {
    await sendSms({
      to: phone,
      body: `${order.restaurantName}: order #${order.orderNumber} confirmed! Track: ${order.trackingUrl}`,
    });
  }
}

/** Diner: status milestones (accepted w/ promise, ready, rejected/refunded). */
export async function notifyDinerStatus(
  phone: string | null,
  email: string,
  order: OrderSummaryForNotice,
  status: string,
  promisedAt: string | null
): Promise<void> {
  const messages: Record<string, string> = {
    accepted: `${order.restaurantName} confirmed order #${order.orderNumber}${
      promisedAt
        ? ` — ready around ${new Date(promisedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
        : ""
    }.`,
    ready: `${order.restaurantName}: order #${order.orderNumber} is READY for pickup!`,
    rejected: `${order.restaurantName} couldn't take order #${order.orderNumber}. Your payment will be refunded.`,
    refunded: `${order.restaurantName}: order #${order.orderNumber} has been refunded.`,
  };
  const body = messages[status];
  if (!body) return;
  if (phone) await sendSms({ to: phone, body: `${body} ${order.trackingUrl}` });
  else
    await sendEmail({
      to: email,
      subject: `Order #${order.orderNumber} update — ${order.restaurantName}`,
      html: `<p>${body}</p><p><a href="${order.trackingUrl}">Track your order</a></p>`,
    });
}

/** Restaurant: new paid order landed (beyond the dashboard tab). */
export async function notifyOwnerNewOrder(
  alertEmail: string | null,
  alertPhone: string | null,
  order: OrderSummaryForNotice
): Promise<void> {
  const itemsText = order.items.map((i) => `${i.qty}× ${i.name}`).join(", ");
  if (alertPhone) {
    await sendSms({
      to: alertPhone,
      body: `NEW ORDER #${order.orderNumber}: ${itemsText} · $${(order.totalCents / 100).toFixed(2)}. Open the dashboard to accept.`,
    });
  }
  if (alertEmail) {
    await sendEmail({
      to: alertEmail,
      subject: `New order #${order.orderNumber} — accept it on the dashboard`,
      html: `<p><strong>${itemsText}</strong> · $${(order.totalCents / 100).toFixed(2)}</p>
<p>Open your dashboard to accept and set a ready time.</p>`,
    });
  }
}
