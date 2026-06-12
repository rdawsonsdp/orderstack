import { requireStaff } from "@/lib/dashboard";
import { OrderBoard, type BoardOrder } from "@/components/dashboard/order-board";

export const dynamic = "force-dynamic";

export default async function DashboardOrdersPage() {
  const { supabase, restaurant } = await requireStaff();

  // Active board + a tail of today's finished orders. RLS scopes to this staff
  // user's restaurant; the explicit filter is for the index, not for security.
  const { data: orders } = await supabase
    .from("orders")
    .select(
      `id, order_number, status, type, placed_at, promised_at, scheduled_for,
       total_cents, special_instructions, created_at,
       customers (name, phone),
       order_items (id, name_snapshot, qty, notes,
         order_item_modifiers (name_snapshot))`
    )
    .eq("restaurant_id", restaurant.id)
    .in("status", ["placed", "accepted", "preparing", "ready", "completed", "rejected"])
    .order("created_at", { ascending: false })
    .limit(60);

  return (
    <OrderBoard
      restaurantId={restaurant.id}
      restaurantName={restaurant.name}
      initialOrders={(orders ?? []) as unknown as BoardOrder[]}
    />
  );
}
