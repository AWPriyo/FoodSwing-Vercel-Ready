import test from "node:test";
import assert from "node:assert/strict";
import {calculateTotals} from "../src/services/pricing.js";

const productsById = new Map([
  [1, {id: 1, name: "Kacchi Biryani", category: "Biriyani", price_paisa: 38000}],
  [2, {id: 2, name: "Margherita Pizza", category: "Pizza", price_paisa: 45000}],
  [3, {id: 3, name: "BBQ Chicken Pizza", category: "Pizza", price_paisa: 62000}],
  [4, {id: 4, name: "Test Item", category: "Other", price_paisa: 50500}]
]);

test("caps the first-order percentage discount and calculates delivery", () => {
  const result = calculateTotals({
    items: [{productId: 1, quantity: 2}],
    productsById,
    promotion: {
      kind: "percent",
      value: 3000,
      max_discount_paisa: 15000,
      minimum_subtotal_paisa: 0,
      first_order_only: true,
      is_active: true
    },
    isFirstOrder: true
  });

  assert.deepEqual(result, {
    subtotalPaisa: 76000,
    deliveryFeePaisa: 0,
    discountPaisa: 15000,
    totalPaisa: 61000
  });
});

test("rounds percentage discounts to whole taka", () => {
  const result = calculateTotals({
    items: [{productId: 4, quantity: 1}],
    productsById,
    promotion: {
      kind: "percent",
      value: 3000,
      max_discount_paisa: null,
      minimum_subtotal_paisa: 0,
      first_order_only: false,
      is_active: true
    },
    isFirstOrder: true
  });

  assert.equal(result.subtotalPaisa, 50500);
  assert.equal(result.discountPaisa, 15200);
});

test("waives delivery with FREEDEL without changing the order subtotal", () => {
  const result = calculateTotals({
    items: [{productId: 1, quantity: 1}],
    productsById,
    promotion: {kind: "free_delivery", value: 0, minimum_subtotal_paisa: 0, is_active: true},
    isFirstOrder: true
  });

  assert.deepEqual(result, {
    subtotalPaisa: 38000,
    deliveryFeePaisa: 6000,
    discountPaisa: 6000,
    totalPaisa: 38000
  });
});

test("applies PIZZA2 to the lower-priced pizza in a pair", () => {
  const result = calculateTotals({
    items: [{productId: 2, quantity: 1}, {productId: 3, quantity: 1}],
    productsById,
    promotion: {kind: "buy_one_get_one", value: 0, minimum_subtotal_paisa: 0, is_active: true},
    isFirstOrder: true
  });

  assert.equal(result.discountPaisa, 45000);
  assert.equal(result.totalPaisa, 62000);
});

test("rejects PIZZA2 when the cart has fewer than two pizzas", () => {
  assert.throws(() => calculateTotals({
    items: [{productId: 2, quantity: 1}],
    productsById,
    promotion: {kind: "buy_one_get_one", value: 0, minimum_subtotal_paisa: 0, is_active: true},
    isFirstOrder: true
  }), {code: "PROMO_ITEMS_NOT_ELIGIBLE"});
});

test("requires COMBO50 orders to exceed ৳400", () => {
  assert.throws(() => calculateTotals({
    items: [{productId: 1, quantity: 1}],
    productsById,
    promotion: {
      kind: "fixed",
      value: 5000,
      minimum_subtotal_paisa: 40100,
      is_active: true
    },
    isFirstOrder: true
  }), {code: "PROMO_MINIMUM_NOT_MET"});
});

test("rejects a first-order promo for a returning customer", () => {
  assert.throws(() => calculateTotals({
    items: [{productId: 1, quantity: 1}],
    productsById,
    promotion: {
      kind: "percent",
      value: 3000,
      max_discount_paisa: 15000,
      minimum_subtotal_paisa: 0,
      first_order_only: true,
      is_active: true
    },
    isFirstOrder: false
  }), {code: "PROMO_FIRST_ORDER_ONLY"});
});
