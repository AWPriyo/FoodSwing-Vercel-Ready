import {createHash, randomBytes, timingSafeEqual} from "node:crypto";
import {Router} from "express";
import {z} from "zod";
import {AppError} from "../errors.js";
import {pool} from "../db/pool.js";
import {asyncHandler} from "../middleware/async-handler.js";
import {calculateTotals} from "../services/pricing.js";

const router = Router();

const orderSchema = z.object({
  customer: z.object({
    name: z.string().trim().min(3).max(120),
    phone: z.string().trim().regex(/^01[3-9]\d{8}$/, "Enter a valid Bangladeshi phone number."),
    address: z.string().trim().min(8).max(500)
  }),
  deliveryLocation: z.object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180)
  }).optional(),
  items: z.array(z.object({
    productId: z.number().int().positive(),
    quantity: z.number().int().min(1).max(99)
  })).min(1).max(30),
  promoCode: z.string().trim().max(20).transform(code => code.toUpperCase()).optional(),
  paymentMethod: z.literal("Cash on Delivery")
});

const money = paisa => Number((paisa / 100).toFixed(2));

function createOrderNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `FS-${date}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function normalizeItems(items) {
  const quantities = new Map();

  for (const item of items) {
    const quantity = (quantities.get(item.productId) || 0) + item.quantity;
    if (quantity > 99) {
      throw new AppError(400, "The quantity for one item cannot exceed 99.", "INVALID_QUANTITY");
    }
    quantities.set(item.productId, quantity);
  }

  return [...quantities]
    .sort(([firstId], [secondId]) => firstId - secondId)
    .map(([productId, quantity]) => ({productId, quantity}));
}

router.post("/", asyncHandler(async (request, response) => {
  const parsed = orderSchema.safeParse(request.body);
  if (!parsed.success) {
    throw new AppError(400, "Please check your order details.", "INVALID_ORDER", parsed.error.flatten());
  }

  const {customer, deliveryLocation, promoCode, paymentMethod} = parsed.data;
  const items = normalizeItems(parsed.data.items);
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    let customerId;
    if (request.auth?.role === "customer") {
      if (request.auth.phone !== customer.phone) {
        throw new AppError(403, "Use the phone number associated with your account.", "ACCOUNT_PHONE_MISMATCH");
      }

      const customerResult = await client.query(
        "SELECT id FROM customers WHERE id = $1 FOR UPDATE",
        [request.auth.id]
      );
      if (!customerResult.rowCount) {
        throw new AppError(401, "Please log in again before ordering.", "SESSION_EXPIRED");
      }
      customerId = customerResult.rows[0].id;
    } else {
      await client.query(`
        INSERT INTO customers (name, phone)
        VALUES ($1, $2)
        ON CONFLICT (phone) DO NOTHING
      `, [customer.name, customer.phone]);

      const customerResult = await client.query(
        "SELECT id, password_hash FROM customers WHERE phone = $1 FOR UPDATE",
        [customer.phone]
      );
      if (customerResult.rows[0].password_hash) {
        throw new AppError(401, "Log in to place an order with this account phone number.", "ACCOUNT_LOGIN_REQUIRED");
      }

      customerId = customerResult.rows[0].id;
      await client.query(
        "UPDATE customers SET name = $1, updated_at = NOW() WHERE id = $2",
        [customer.name, customerId]
      );
    }

    const productResult = await client.query(`
      SELECT id, name, category, price_paisa, is_available
      FROM products
      WHERE id = ANY($1::int[]) AND is_available = TRUE
      FOR SHARE
    `, [items.map(item => item.productId)]);

    if (productResult.rows.length !== items.length) {
      throw new AppError(409, "One or more selected items are unavailable. Refresh the menu and try again.", "PRODUCT_UNAVAILABLE");
    }

    const productsById = new Map(productResult.rows.map(product => [product.id, product]));
    const firstOrderResult = await client.query(
      "SELECT NOT EXISTS (SELECT 1 FROM orders WHERE customer_id = $1) AS is_first_order",
      [customerId]
    );
    const isFirstOrder = firstOrderResult.rows[0].is_first_order;

    let promotion = null;
    if (promoCode) {
      const promotionResult = await client.query(
        "SELECT * FROM promotions WHERE code = $1 AND is_active = TRUE",
        [promoCode]
      );
      if (!promotionResult.rowCount) {
        throw new AppError(422, "Promo code is invalid or inactive.", "INVALID_PROMO");
      }
      promotion = promotionResult.rows[0];
    }

    const totals = calculateTotals({items, productsById, promotion, isFirstOrder});
    const trackingToken = randomBytes(32).toString("hex");
    const trackingTokenHash = createHash("sha256").update(trackingToken).digest("hex");
    const orderNumber = createOrderNumber();

    const orderResult = await client.query(`
      INSERT INTO orders (
        order_number, tracking_token_hash, customer_id, delivery_address,
        delivery_latitude, delivery_longitude, payment_method, status, promo_code, subtotal_paisa,
        delivery_fee_paisa, discount_paisa, total_paisa
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', $8, $9, $10, $11, $12)
      RETURNING id, order_number, status, promo_code, subtotal_paisa,
                delivery_fee_paisa, discount_paisa, total_paisa, created_at
    `, [
      orderNumber,
      trackingTokenHash,
      customerId,
      customer.address,
      deliveryLocation?.latitude ?? null,
      deliveryLocation?.longitude ?? null,
      paymentMethod,
      promoCode || null,
      totals.subtotalPaisa,
      totals.deliveryFeePaisa,
      totals.discountPaisa,
      totals.totalPaisa
    ]);

    const order = orderResult.rows[0];
    const responseItems = [];

    for (const item of items) {
      const product = productsById.get(item.productId);
      const lineTotalPaisa = product.price_paisa * item.quantity;
      await client.query(`
        INSERT INTO order_items (
          order_id, product_id, product_name, unit_price_paisa, quantity, line_total_paisa
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `, [order.id, product.id, product.name, product.price_paisa, item.quantity, lineTotalPaisa]);

      responseItems.push({
        productId: product.id,
        name: product.name,
        quantity: item.quantity,
        total: money(lineTotalPaisa)
      });
    }

    await client.query(`
      INSERT INTO order_status_history (order_id, previous_status, new_status)
      VALUES ($1, NULL, 'Pending')
    `, [order.id]);

    await client.query("COMMIT");
    transactionStarted = false;

    response.status(201).json({
      order: {
        orderNumber: order.order_number,
        trackingToken,
        status: order.status,
        promoCode: order.promo_code,
        subtotal: money(order.subtotal_paisa),
        deliveryFee: money(order.delivery_fee_paisa),
        discount: money(order.discount_paisa),
        total: money(order.total_paisa),
        createdAt: order.created_at,
        items: responseItems
      }
    });
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    client.release();
  }
}));

router.get("/:orderNumber", asyncHandler(async (request, response) => {
  const orderNumber = z.string().min(10).max(40).safeParse(request.params.orderNumber);
  const trackingToken = request.get("x-order-token") || "";
  if (!orderNumber.success || trackingToken.length < 32) {
    throw new AppError(404, "Order not found.", "ORDER_NOT_FOUND");
  }

  const tokenHash = createHash("sha256").update(trackingToken).digest("hex");
  const result = await pool.query(`
    SELECT id, order_number, tracking_token_hash, status, subtotal_paisa,
           delivery_fee_paisa, discount_paisa, total_paisa, created_at
    FROM orders
    WHERE order_number = $1
  `, [orderNumber.data]);
  const order = result.rows[0];

  const savedHash = Buffer.from(order?.tracking_token_hash || "");
  const suppliedHash = Buffer.from(tokenHash);
  const tokenMatches = order &&
    savedHash.length === suppliedHash.length &&
    timingSafeEqual(savedHash, suppliedHash);
  if (!tokenMatches) {
    throw new AppError(404, "Order not found.", "ORDER_NOT_FOUND");
  }

  const itemsResult = await pool.query(`
    SELECT product_name, quantity, line_total_paisa
    FROM order_items
    WHERE order_id = $1
    ORDER BY id
  `, [order.id]);

  response.json({
    order: {
      orderNumber: order.order_number,
      status: order.status,
      subtotal: money(order.subtotal_paisa),
      deliveryFee: money(order.delivery_fee_paisa),
      discount: money(order.discount_paisa),
      total: money(order.total_paisa),
      createdAt: order.created_at,
      items: itemsResult.rows.map(item => ({
        name: item.product_name,
        quantity: item.quantity,
        total: money(item.line_total_paisa)
      }))
    }
  });
}));

export default router;
