import { notFound } from "next/navigation";
import { getStorefrontData } from "@/lib/menu";
import { Checkout } from "@/components/storefront/checkout";

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const data = await getStorefrontData(tenant);
  if (!data) notFound();

  return <Checkout data={data} />;
}
