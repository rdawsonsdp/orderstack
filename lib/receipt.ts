/**
 * Receipt/kitchen-ticket formatting, shared by the browser print view and
 * the CloudPRNT plain-text job. 42 columns fits 80mm thermal paper.
 */

export interface ReceiptOrder {
  order_number: number;
  type: string;
  status: string;
  placed_at: string | null;
  created_at: string;
  scheduled_for: string | null;
  promised_at: string | null;
  special_instructions: string | null;
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  tip_cents: number;
  platform_fee_cents: number;
  total_cents: number;
  payment_method_label: string | null;
  customers: { name: string; phone: string | null } | null;
  restaurants: { name: string; timezone: string } | null;
  order_items: {
    name_snapshot: string;
    price_snapshot_cents: number;
    qty: number;
    notes: string | null;
    order_item_modifiers: { name_snapshot: string; price_snapshot_cents: number }[];
  }[];
}

const WIDTH = 42;

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function row(left: string, right: string): string {
  const pad = WIDTH - left.length - right.length;
  return pad > 0 ? left + " ".repeat(pad) + right : `${left} ${right}`;
}

function center(text: string): string {
  const pad = Math.max(0, Math.floor((WIDTH - text.length) / 2));
  return " ".repeat(pad) + text;
}

function rule(char = "-"): string {
  return char.repeat(WIDTH);
}

export function formatLocalTime(ts: string, timeZone: string): string {
  return new Date(ts).toLocaleString("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Plain-text ticket for thermal printers (and a faithful preview). */
export function receiptText(order: ReceiptOrder): string {
  const tz = order.restaurants?.timezone ?? "America/Chicago";
  const lines: string[] = [];

  lines.push(center(order.restaurants?.name ?? "OrderStack"));
  lines.push(center(`ORDER #${order.order_number}`));
  lines.push(rule("="));
  lines.push(row(order.type.toUpperCase(), formatLocalTime(order.placed_at ?? order.created_at, tz)));
  if (order.scheduled_for) {
    lines.push(row("SCHEDULED", formatLocalTime(order.scheduled_for, tz)));
  }
  if (order.promised_at) {
    lines.push(row("PROMISED", formatLocalTime(order.promised_at, tz)));
  }
  lines.push(row("CUSTOMER", order.customers?.name ?? "Guest"));
  if (order.customers?.phone) lines.push(row("", order.customers.phone));
  lines.push(rule());

  for (const item of order.order_items) {
    const unit =
      item.price_snapshot_cents +
      item.order_item_modifiers.reduce((s, m) => s + m.price_snapshot_cents, 0);
    lines.push(row(`${item.qty} x ${item.name_snapshot}`, money(unit * item.qty)));
    for (const mod of item.order_item_modifiers) {
      lines.push(
        row(
          `    ${mod.name_snapshot}`,
          mod.price_snapshot_cents > 0 ? `+${money(mod.price_snapshot_cents)}` : ""
        )
      );
    }
    if (item.notes) lines.push(`    >> ${item.notes}`);
  }

  if (order.special_instructions) {
    lines.push(rule());
    lines.push("NOTE: " + order.special_instructions);
  }

  lines.push(rule());
  lines.push(row("Subtotal", money(order.subtotal_cents)));
  if (order.discount_cents > 0) {
    lines.push(row("Discount", `-${money(order.discount_cents)}`));
  }
  lines.push(row("Tax", money(order.tax_cents)));
  if (order.tip_cents > 0) lines.push(row("Tip", money(order.tip_cents)));
  lines.push(row("Service fee", money(order.platform_fee_cents)));
  lines.push(rule());
  lines.push(row("TOTAL", money(order.total_cents)));
  lines.push("");
  lines.push(center(order.payment_method_label ? `PAID - ${order.payment_method_label}` : "PAYMENT PENDING"));
  lines.push("");
  lines.push(center("Thank you!"));
  lines.push("");

  return lines.join("\n");
}

/** The select string both the print page and CloudPRNT job use. */
export const RECEIPT_ORDER_SELECT = `order_number, type, status, placed_at, created_at,
  scheduled_for, promised_at, special_instructions,
  subtotal_cents, discount_cents, tax_cents, tip_cents, platform_fee_cents,
  total_cents, payment_method_label,
  customers (name, phone),
  restaurants (name, timezone),
  order_items (name_snapshot, price_snapshot_cents, qty, notes,
    order_item_modifiers (name_snapshot, price_snapshot_cents))`;
