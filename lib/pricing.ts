import { z } from "zod";

/**
 * Server-side pricing engine. The client cart is a *suggestion*: every order
 * is re-priced here from DB rows before a PaymentIntent is created. All math
 * is integer cents.
 */

export const cartSchema = z.object({
  locationId: z.guid(),
  type: z.enum(["pickup", "delivery"]),
  tipCents: z.number().int().min(0).default(0),
  scheduledFor: z.iso.datetime().nullish(),
  specialInstructions: z.string().max(500).nullish(),
  lines: z
    .array(
      z.object({
        itemId: z.guid(),
        qty: z.number().int().min(1).max(99),
        notes: z.string().max(280).nullish(),
        modifierIds: z.array(z.guid()).default([]),
      })
    )
    .min(1),
});

export type Cart = z.infer<typeof cartSchema>;

/** Menu rows fetched from the DB for the items in the cart. */
export interface PricingContext {
  items: Map<
    string,
    {
      id: string;
      name: string;
      priceCents: number;
      isAvailable: boolean;
      soldOutUntil: string | null;
      modifierGroups: Array<{
        id: string;
        name: string;
        minSelect: number;
        maxSelect: number | null;
        required: boolean;
        modifiers: Map<
          string,
          { id: string; name: string; priceDeltaCents: number; isAvailable: boolean }
        >;
      }>;
    }
  >;
  taxRate: number; // e.g. 0.1075
  platformFeeCents: number; // diner-paid convenience fee
  deliveryFeeCents: number; // 0 for pickup; quoted for delivery
}

export interface PricedLine {
  itemId: string;
  nameSnapshot: string;
  priceSnapshotCents: number;
  qty: number;
  notes: string | null;
  modifiers: Array<{
    modifierId: string;
    nameSnapshot: string;
    priceSnapshotCents: number;
  }>;
  lineTotalCents: number;
}

export interface PricedOrder {
  lines: PricedLine[];
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  deliveryFeeCents: number;
  platformFeeCents: number;
  totalCents: number;
}

export class PricingError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "PricingError";
  }
}

export function priceOrder(cart: Cart, ctx: PricingContext): PricedOrder {
  const lines: PricedLine[] = cart.lines.map((line) => {
    const item = ctx.items.get(line.itemId);
    if (!item) {
      throw new PricingError(`Item ${line.itemId} not found`, "ITEM_NOT_FOUND");
    }
    if (!item.isAvailable) {
      throw new PricingError(`${item.name} is unavailable`, "ITEM_UNAVAILABLE");
    }
    if (item.soldOutUntil && new Date(item.soldOutUntil) > new Date()) {
      throw new PricingError(`${item.name} is sold out`, "ITEM_SOLD_OUT");
    }

    const selected = new Set(line.modifierIds);
    const pricedModifiers: PricedLine["modifiers"] = [];

    for (const group of item.modifierGroups) {
      const inGroup = line.modifierIds.filter((id) => group.modifiers.has(id));

      const min = group.required ? Math.max(group.minSelect, 1) : group.minSelect;
      if (inGroup.length < min) {
        throw new PricingError(
          `${item.name}: select at least ${min} from "${group.name}"`,
          "MODIFIER_MIN"
        );
      }
      if (group.maxSelect !== null && inGroup.length > group.maxSelect) {
        throw new PricingError(
          `${item.name}: select at most ${group.maxSelect} from "${group.name}"`,
          "MODIFIER_MAX"
        );
      }

      for (const id of inGroup) {
        const mod = group.modifiers.get(id)!;
        if (!mod.isAvailable) {
          throw new PricingError(`${mod.name} is unavailable`, "MODIFIER_UNAVAILABLE");
        }
        pricedModifiers.push({
          modifierId: mod.id,
          nameSnapshot: mod.name,
          priceSnapshotCents: mod.priceDeltaCents,
        });
        selected.delete(id);
      }
    }

    if (selected.size > 0) {
      throw new PricingError(
        `${item.name}: modifier not valid for this item`,
        "MODIFIER_INVALID"
      );
    }

    const unitCents =
      item.priceCents +
      pricedModifiers.reduce((sum, m) => sum + m.priceSnapshotCents, 0);

    return {
      itemId: item.id,
      nameSnapshot: item.name,
      priceSnapshotCents: item.priceCents,
      qty: line.qty,
      notes: line.notes ?? null,
      modifiers: pricedModifiers,
      lineTotalCents: unitCents * line.qty,
    };
  });

  const subtotalCents = lines.reduce((sum, l) => sum + l.lineTotalCents, 0);
  const taxCents = Math.round(subtotalCents * ctx.taxRate);
  const deliveryFeeCents = cart.type === "delivery" ? ctx.deliveryFeeCents : 0;

  return {
    lines,
    subtotalCents,
    taxCents,
    tipCents: cart.tipCents,
    deliveryFeeCents,
    platformFeeCents: ctx.platformFeeCents,
    totalCents:
      subtotalCents + taxCents + cart.tipCents + deliveryFeeCents + ctx.platformFeeCents,
  };
}
