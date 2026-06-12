import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/dashboard";
import { receiptText, RECEIPT_ORDER_SELECT, type ReceiptOrder } from "@/lib/receipt";
import { PrintTrigger } from "@/components/dashboard/print-trigger";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return { title: `Receipt ${id.slice(0, 8)}` };
}

/**
 * Printable kitchen ticket — 80mm thermal layout that also prints fine on a
 * regular sheet. Opens the OS print dialog automatically, so it works with
 * any local printer; real thermal printers use the CloudPRNT endpoint.
 */
export default async function PrintOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const { supabase } = await requireStaff();
  const { data: order } = (await supabase
    .from("orders")
    .select(RECEIPT_ORDER_SELECT)
    .eq("id", id)
    .single()) as { data: ReceiptOrder | null };

  if (!order) notFound();

  return (
    <div className="receipt-root">
      <style>{`
        .receipt-root { min-height: 100vh; background: #f3f4f6; }
        .ticket {
          width: 80mm; margin: 0 auto; padding: 6mm 4mm; background: #fff;
          font-family: ui-monospace, Menlo, monospace; font-size: 12px;
          line-height: 1.45; white-space: pre; box-shadow: 0 1px 4px rgb(0 0 0 / .2);
        }
        .print-toolbar { text-align: center; padding: 12px; }
        .print-toolbar button {
          font: inherit; font-weight: 700; padding: 10px 24px; cursor: pointer;
          border: none; border-radius: 8px; background: #111827; color: #fff;
        }
        @media print {
          @page { size: 80mm auto; margin: 0; }
          body { background: #fff; }
          .receipt-root { background: #fff; }
          .ticket { width: auto; margin: 0; box-shadow: none; }
          .print-toolbar { display: none; }
        }
      `}</style>
      <div className="print-toolbar">
        <PrintTrigger />
      </div>
      <div className="ticket">{receiptText(order)}</div>
    </div>
  );
}
