import {AppError} from "../errors.js";

export function calculateTotals({
  items,
  productsById,
  promotion,
  isFirstOrder,
  deliveryFeePaisa = 6000,
  freeDeliveryThresholdPaisa = 59900
}) {
  const subtotalPaisa = items.reduce((total, item) => {
    const product = productsById.get(item.productId);
    return total + product.price_paisa * item.quantity;
  }, 0);

  const deliveryFeePaisaForOrder =
    subtotalPaisa === 0 || subtotalPaisa >= freeDeliveryThresholdPaisa
      ? 0
      : deliveryFeePaisa;

  let discountPaisa = 0;

  if (promotion) {
    if (!promotion.is_active) {
      throw new AppError(422, "This promo code is no longer available.", "PROMO_INACTIVE");
    }

    if (subtotalPaisa < promotion.minimum_subtotal_paisa) {
      throw new AppError(422, "Your order does not meet this promo's minimum amount.", "PROMO_MINIMUM_NOT_MET");
    }

    if (promotion.first_order_only && !isFirstOrder) {
      throw new AppError(422, "This promo code is available for first orders only.", "PROMO_FIRST_ORDER_ONLY");
    }

    if (promotion.kind === "percent") {
      discountPaisa = Math.round(subtotalPaisa * promotion.value / 10000 / 100) * 100;
      if (promotion.max_discount_paisa !== null) {
        discountPaisa = Math.min(discountPaisa, promotion.max_discount_paisa);
      }
    } else if (promotion.kind === "fixed") {
      discountPaisa = promotion.value;
    } else if (promotion.kind === "free_delivery") {
      discountPaisa = deliveryFeePaisaForOrder;
    } else if (promotion.kind === "buy_one_get_one") {
      const pizzaPrices = items.flatMap(item => {
        const product = productsById.get(item.productId);
        return product.category === "Pizza"
          ? Array(item.quantity).fill(product.price_paisa)
          : [];
      }).sort((a, b) => a - b);

      if (pizzaPrices.length < 2) {
        throw new AppError(422, "Add at least two pizzas to use this promo.", "PROMO_ITEMS_NOT_ELIGIBLE");
      }

      for (let index = 0; index + 1 < pizzaPrices.length; index += 2) {
        discountPaisa += pizzaPrices[index];
      }
    } else {
      throw new AppError(500, "Unsupported promotion configuration.", "PROMO_CONFIGURATION_ERROR");
    }
  }

  discountPaisa = Math.min(discountPaisa, subtotalPaisa + deliveryFeePaisaForOrder);

  return {
    subtotalPaisa,
    deliveryFeePaisa: deliveryFeePaisaForOrder,
    discountPaisa,
    totalPaisa: subtotalPaisa + deliveryFeePaisaForOrder - discountPaisa
  };
}
