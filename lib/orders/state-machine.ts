/**
 * Order state machine — mirror of the validate_order_transition() trigger in
 * supabase/migrations/20260612000001_initial_schema.sql. Keep the two in sync;
 * the DB trigger is the enforcement layer, this is for UI logic and tests.
 *
 * pending_payment → placed → accepted → preparing → ready →
 *    pickup:   completed
 *    delivery: courier_assigned → picked_up → delivered → completed
 * (rejected / canceled / refunded as exits)
 */

export const ORDER_STATUSES = [
  "pending_payment",
  "placed",
  "accepted",
  "preparing",
  "ready",
  "courier_assigned",
  "picked_up",
  "delivered",
  "completed",
  "rejected",
  "canceled",
  "refunded",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending_payment: ["placed", "canceled"],
  placed: ["accepted", "rejected", "canceled"],
  accepted: ["preparing", "ready", "canceled"],
  preparing: ["ready", "canceled"],
  ready: ["completed", "courier_assigned", "canceled"],
  courier_assigned: ["picked_up", "canceled"],
  picked_up: ["delivered"],
  delivered: ["completed"],
  rejected: ["refunded"],
  canceled: ["refunded"],
  completed: ["refunded"],
  refunded: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Statuses the restaurant tablet shows as actionable. */
export const ACTIVE_STATUSES: readonly OrderStatus[] = [
  "placed",
  "accepted",
  "preparing",
  "ready",
  "courier_assigned",
  "picked_up",
];

export const TERMINAL_STATUSES: readonly OrderStatus[] = [
  "completed",
  "rejected",
  "canceled",
  "refunded",
];
