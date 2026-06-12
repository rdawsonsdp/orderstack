/**
 * Pricing engine smoke test: pnpm dlx tsx scripts/verify-pricing.ts
 */
import { priceOrder, PricingError, type Cart, type PricingContext } from "../lib/pricing";

let failures = 0;
function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok    ${label}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL  ${label}: ${(err as Error).message}`);
  }
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const COFFEE = "00000000-0000-0000-0000-00000000c0fe";
const SIZE_LG = "00000000-0000-0000-0000-0000000000a1";
const CREAM = "00000000-0000-0000-0000-0000000000a2";

const ctx: PricingContext = {
  items: new Map([
    [
      COFFEE,
      {
        id: COFFEE,
        name: "Drip Coffee",
        priceCents: 250,
        isAvailable: true,
        soldOutUntil: null,
        modifierGroups: [
          {
            id: "g1",
            name: "Coffee Size",
            minSelect: 1,
            maxSelect: 1,
            required: true,
            modifiers: new Map([
              [SIZE_LG, { id: SIZE_LG, name: "Large", priceDeltaCents: 100, isAvailable: true }],
            ]),
          },
          {
            id: "g2",
            name: "Cream & Sugar",
            minSelect: 0,
            maxSelect: 4,
            required: false,
            modifiers: new Map([
              [CREAM, { id: CREAM, name: "Cream", priceDeltaCents: 0, isAvailable: true }],
            ]),
          },
        ],
      },
    ],
  ]),
  taxRate: 0.1075,
  platformFeeCents: 129,
  deliveryFeeCents: 0,
};

const cart: Cart = {
  locationId: "22222222-2222-2222-2222-222222222222",
  type: "pickup",
  tipCents: 100,
  lines: [{ itemId: COFFEE, qty: 2, modifierIds: [SIZE_LG, CREAM] }],
};

check("totals: 2x (250+100) = 700 subtotal, 75 tax, 1004 total", () => {
  const priced = priceOrder(cart, ctx);
  assert(priced.subtotalCents === 700, `subtotal ${priced.subtotalCents}`);
  assert(priced.taxCents === 75, `tax ${priced.taxCents}`); // round(700 * .1075)
  assert(
    priced.totalCents === 700 + 75 + 100 + 0 + 129,
    `total ${priced.totalCents}`
  );
  assert(priced.lines[0].modifiers.length === 2, "modifier snapshots");
});

check("missing required group throws MODIFIER_MIN", () => {
  try {
    priceOrder({ ...cart, lines: [{ itemId: COFFEE, qty: 1, modifierIds: [] }] }, ctx);
    assert(false, "no error");
  } catch (err) {
    assert(err instanceof PricingError && err.code === "MODIFIER_MIN", String(err));
  }
});

check("unknown modifier throws MODIFIER_INVALID", () => {
  try {
    priceOrder(
      {
        ...cart,
        lines: [
          {
            itemId: COFFEE,
            qty: 1,
            modifierIds: [SIZE_LG, "00000000-0000-0000-0000-00000000dead"],
          },
        ],
      },
      ctx
    );
    assert(false, "no error");
  } catch (err) {
    assert(err instanceof PricingError && err.code === "MODIFIER_INVALID", String(err));
  }
});

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll pricing checks passed.");
process.exit(failures ? 1 : 0);
