import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cartSchema, priceOrder, PricingError } from "@/lib/pricing";
import { loadPricingContext } from "@/lib/pricing-server";

/**
 * POST /api/orders/price — re-price a cart from DB rows. This is the only
 * total the UI displays and the only total a PaymentIntent is created from.
 */
export async function POST(request: NextRequest) {
  let cart;
  try {
    cart = cartSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "INVALID_CART", issues: err.issues },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const result = await loadPricingContext(cart);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  try {
    return NextResponse.json(priceOrder(cart, result.ctx));
  } catch (err) {
    if (err instanceof PricingError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: 422 }
      );
    }
    throw err;
  }
}
