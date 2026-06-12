import { requireStaff } from "@/lib/dashboard";
import { MenuManager, type ManagedItem } from "@/components/dashboard/menu-manager";

export const dynamic = "force-dynamic";

export default async function DashboardMenuPage() {
  const { supabase, restaurant } = await requireStaff();

  const { data: menus } = await supabase
    .from("menus")
    .select(
      `id, name, active,
       categories (id, name, sort,
         items (id, name, price_cents, sort, is_available, sold_out_until))`
    )
    .eq("restaurant_id", restaurant.id);

  const menu = (menus ?? []).find((m) => m.active);
  const categories = ((menu?.categories ?? []) as Array<{
    id: string;
    name: string;
    sort: number;
    items: ManagedItem[];
  }>)
    .map((c) => ({ ...c, items: [...c.items].sort((a, b) => a.sort - b.sort) }))
    .sort((a, b) => a.sort - b.sort);

  return <MenuManager restaurantName={restaurant.name} categories={categories} />;
}
