import bcrypt from "bcryptjs";
import {Router} from "express";
import {z} from "zod";
import {AppError} from "../errors.js";
import {pool} from "../db/pool.js";
import {asyncHandler} from "../middleware/async-handler.js";
import {requireAdmin} from "../middleware/admin-auth.js";

const router = Router();
const statuses = ["Pending", "Confirmed", "Preparing", "Out for delivery", "Delivered", "Cancelled"];
const allowedTransitions = {
  Pending: ["Confirmed", "Cancelled"],
  Confirmed: ["Preparing", "Cancelled"],
  Preparing: ["Cancelled"],
  "Out for delivery": ["Delivered"],
  Delivered: [],
  Cancelled: []
};

router.use(requireAdmin);

router.get("/orders", asyncHandler(async (request, response) => {
  const parsed = z.coerce.number().int().min(1).max(100).default(50).safeParse(request.query.limit);
  if (!parsed.success) {
    throw new AppError(400, "Limit must be between 1 and 100.", "INVALID_LIMIT");
  }

  const result = await pool.query(`
    SELECT o.id, o.order_number, o.status, o.payment_method, o.promo_code,
           o.subtotal_paisa, o.delivery_fee_paisa, o.discount_paisa,
           o.total_paisa, o.delivery_address, o.delivery_latitude,
           o.delivery_longitude, o.created_at,
           c.name AS customer_name, c.phone AS customer_phone,
           ra.status AS assignment_status,
           r.id AS rider_id, r.name AS rider_name, r.phone AS rider_phone,
           r.delivery_area AS rider_delivery_area,
           r.vehicle_type AS rider_vehicle_type,
           r.vehicle_registration AS rider_vehicle_registration,
           COALESCE(
             json_agg(json_build_object(
               'productId', oi.product_id,
               'name', oi.product_name,
               'quantity', oi.quantity,
               'totalPaisa', oi.line_total_paisa
             )) FILTER (WHERE oi.id IS NOT NULL),
             '[]'::json
           ) AS items
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    LEFT JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN rider_assignments ra ON ra.order_id = o.id
    LEFT JOIN riders r ON r.id = ra.rider_id
    GROUP BY o.id, c.name, c.phone, ra.status, r.id
    ORDER BY o.created_at DESC
    LIMIT $1
  `, [parsed.data]);

  response.json({
    items: result.rows.map(order => ({
      orderNumber: order.order_number,
      status: order.status,
      paymentMethod: order.payment_method,
      promoCode: order.promo_code,
      subtotal: Number(order.subtotal_paisa) / 100,
      deliveryFee: Number(order.delivery_fee_paisa) / 100,
      discount: Number(order.discount_paisa) / 100,
      total: Number(order.total_paisa) / 100,
      deliveryAddress: order.delivery_address,
      deliveryLocation: order.delivery_latitude === null ? null : {
        latitude: Number(order.delivery_latitude),
        longitude: Number(order.delivery_longitude)
      },
      createdAt: order.created_at,
      customer: {name: order.customer_name, phone: order.customer_phone},
      rider: order.rider_id ? {
        id: Number(order.rider_id),
        name: order.rider_name,
        phone: order.rider_phone,
        deliveryArea: order.rider_delivery_area,
        vehicleType: order.rider_vehicle_type,
        vehicleRegistration: order.rider_vehicle_registration,
        assignmentStatus: order.assignment_status
      } : null,
      items: order.items.map(item => ({
        productId: item.productId,
        name: item.name,
        quantity: item.quantity,
        total: Number(item.totalPaisa) / 100
      }))
    }))
  });
}));

router.get("/orders/:orderNumber/history", asyncHandler(async (request, response) => {
  const parsed = z.string().min(10).max(40).safeParse(request.params.orderNumber);
  if (!parsed.success) throw new AppError(400, "Provide a valid order number.", "INVALID_ORDER_NUMBER");

  const orderResult = await pool.query("SELECT id FROM orders WHERE order_number = $1", [parsed.data]);
  const order = orderResult.rows[0];
  if (!order) throw new AppError(404, "Order not found.", "ORDER_NOT_FOUND");

  const result = await pool.query(`
    SELECT event_type, detail, changed_by, rider_name, created_at
    FROM (
      SELECT 'Order status' AS event_type, new_status AS detail,
             changed_by, NULL::TEXT AS rider_name, created_at
      FROM order_status_history
      WHERE order_id = $1
      UNION ALL
      SELECT 'Rider delivery' AS event_type, e.event AS detail,
             e.changed_by, r.name AS rider_name, e.created_at
      FROM rider_assignment_events e
      JOIN riders r ON r.id = e.rider_id
      WHERE e.order_id = $1
    ) history
    ORDER BY created_at, event_type
  `, [order.id]);

  response.json({items: result.rows.map(event => ({
    type: event.event_type,
    detail: event.detail,
    changedBy: event.changed_by,
    riderName: event.rider_name,
    createdAt: event.created_at
  }))});
}));

router.get("/riders", asyncHandler(async (request, response) => {
  const result = await pool.query(`
    SELECT r.id, r.name, r.phone, r.delivery_area, r.vehicle_type,
           r.vehicle_registration, r.is_active, r.availability,
           EXISTS (
             SELECT 1 FROM rider_assignments ra
             WHERE ra.rider_id = r.id AND ra.status IN ('Assigned', 'Accepted', 'Picked up')
           ) AS has_active_delivery
    FROM riders r
    ORDER BY r.created_at DESC
  `);
  response.json({items: result.rows.map(rider => ({
    id: Number(rider.id),
    name: rider.name,
    phone: rider.phone,
    deliveryArea: rider.delivery_area,
    vehicleType: rider.vehicle_type,
    vehicleRegistration: rider.vehicle_registration,
    isActive: rider.is_active,
    availability: rider.availability,
    hasActiveDelivery: rider.has_active_delivery
  }))});
}));

router.post("/riders", asyncHandler(async (request, response) => {
  const parsed = z.object({
    name: z.string().trim().min(3).max(120),
    phone: z.string().trim().regex(/^01[3-9]\d{8}$/),
    password: z.string().min(12).max(72).refine(
      password => Buffer.byteLength(password, "utf8") <= 72,
      "Password must not exceed 72 UTF-8 bytes."
    ),
    deliveryArea: z.string().trim().min(2).max(120),
    vehicleType: z.string().trim().min(2).max(40),
    vehicleRegistration: z.string().trim().min(2).max(40)
  }).safeParse(request.body);

  if (!parsed.success) {
    throw new AppError(400, "Provide valid rider details and a password of at least 12 characters.", "INVALID_RIDER");
  }

  const input = parsed.data;
  const passwordHash = await bcrypt.hash(input.password, 12);
  try {
    const result = await pool.query(`
      INSERT INTO riders (name, phone, password_hash, delivery_area, vehicle_type, vehicle_registration)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, name, phone, delivery_area, vehicle_type, vehicle_registration, is_active, availability
    `, [input.name, input.phone, passwordHash, input.deliveryArea, input.vehicleType, input.vehicleRegistration]);
    const rider = result.rows[0];
    response.status(201).json({rider: {
      id: Number(rider.id),
      name: rider.name,
      phone: rider.phone,
      deliveryArea: rider.delivery_area,
      vehicleType: rider.vehicle_type,
      vehicleRegistration: rider.vehicle_registration,
      isActive: rider.is_active,
      availability: rider.availability,
      hasActiveDelivery: false
    }});
  } catch (error) {
    if (error.code === "23505") {
      throw new AppError(409, "A rider account already uses this phone number.", "RIDER_PHONE_EXISTS");
    }
    throw error;
  }
}));

router.patch("/riders/:id", asyncHandler(async (request, response) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id);
  const parsed = z.object({isActive: z.boolean()}).safeParse(request.body);
  if (!id.success || !parsed.success) {
    throw new AppError(400, "Provide a rider ID and active status.", "INVALID_RIDER_UPDATE");
  }

  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    const riderResult = await client.query("SELECT id FROM riders WHERE id = $1 FOR UPDATE", [id.data]);
    if (!riderResult.rowCount) throw new AppError(404, "Rider not found.", "RIDER_NOT_FOUND");

    if (!parsed.data.isActive) {
      const activeDelivery = await client.query(`
        SELECT 1 FROM rider_assignments
        WHERE rider_id = $1 AND status IN ('Assigned', 'Accepted', 'Picked up')
        LIMIT 1
      `, [id.data]);
      if (activeDelivery.rowCount) {
        throw new AppError(409, "Complete or reassign this rider's active delivery before disabling the account.", "RIDER_HAS_ACTIVE_DELIVERY");
      }
    }

    const result = await client.query(`
      UPDATE riders SET is_active = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, is_active
    `, [parsed.data.isActive, id.data]);
    await client.query("COMMIT");
    transactionStarted = false;
    response.json({id: Number(result.rows[0].id), isActive: result.rows[0].is_active});
  } catch (error) {
    if (transactionStarted) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

router.post("/orders/:orderNumber/rider", asyncHandler(async (request, response) => {
  const orderNumber = z.string().min(10).max(40).safeParse(request.params.orderNumber);
  const parsed = z.object({riderId: z.coerce.number().int().positive()}).safeParse(request.body);
  if (!orderNumber.success || !parsed.success) {
    throw new AppError(400, "Provide a valid order number and rider.", "INVALID_RIDER_ASSIGNMENT");
  }

  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    const orderResult = await client.query(
      "SELECT id, status FROM orders WHERE order_number = $1 FOR UPDATE",
      [orderNumber.data]
    );
    const order = orderResult.rows[0];
    if (!order) throw new AppError(404, "Order not found.", "ORDER_NOT_FOUND");
    if (order.status !== "Preparing") {
      throw new AppError(409, "Riders can only be assigned to orders being prepared.", "ORDER_NOT_READY_FOR_ASSIGNMENT");
    }

    const riderResult = await client.query(
      "SELECT id, is_active, availability FROM riders WHERE id = $1 FOR UPDATE",
      [parsed.data.riderId]
    );
    const rider = riderResult.rows[0];
    if (!rider || !rider.is_active || rider.availability !== "available") {
      throw new AppError(409, "Choose an active rider who is available.", "RIDER_UNAVAILABLE");
    }

    const existingResult = await client.query(
      "SELECT rider_id, status FROM rider_assignments WHERE order_id = $1 FOR UPDATE",
      [order.id]
    );
    const existing = existingResult.rows[0];
    const activeDeliveryResult = await client.query(`
      SELECT order_id FROM rider_assignments
      WHERE rider_id = $1 AND order_id <> $2
        AND status IN ('Assigned', 'Accepted', 'Picked up')
      LIMIT 1
    `, [rider.id, order.id]);
    if (activeDeliveryResult.rowCount) {
      throw new AppError(409, "This rider already has an active delivery.", "RIDER_BUSY");
    }

    await client.query(`
      INSERT INTO rider_assignments (
        order_id, rider_id, assigned_by, status, assigned_at, accepted_at, picked_up_at, delivered_at, updated_at
      ) VALUES ($1, $2, $3, 'Assigned', NOW(), NULL, NULL, NULL, NOW())
      ON CONFLICT (order_id) DO UPDATE SET
        rider_id = EXCLUDED.rider_id,
        assigned_by = EXCLUDED.assigned_by,
        status = 'Assigned',
        assigned_at = NOW(),
        accepted_at = NULL,
        picked_up_at = NULL,
        delivered_at = NULL,
        updated_at = NOW()
    `, [order.id, rider.id, request.auth.id]);
    await client.query(`
      INSERT INTO rider_assignment_events (order_id, rider_id, event, changed_by)
      VALUES ($1, $2, $3, $4)
    `, [order.id, rider.id, existing ? "Reassigned" : "Assigned", `admin:${request.auth.email}`]);

    await client.query("COMMIT");
    transactionStarted = false;
    response.json({orderNumber: orderNumber.data, riderId: Number(rider.id), assignmentStatus: "Assigned"});
  } catch (error) {
    if (transactionStarted) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

router.delete("/orders/:orderNumber/rider", asyncHandler(async (request, response) => {
  const orderNumber = z.string().min(10).max(40).safeParse(request.params.orderNumber);
  if (!orderNumber.success) throw new AppError(400, "Provide a valid order number.", "INVALID_ORDER_NUMBER");

  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    const assignmentResult = await client.query(`
      SELECT o.id AS order_id, ra.rider_id, ra.status
      FROM orders o
      JOIN rider_assignments ra ON ra.order_id = o.id
      WHERE o.order_number = $1
      FOR UPDATE OF o, ra
    `, [orderNumber.data]);
    const assignment = assignmentResult.rows[0];
    if (!assignment || !["Assigned", "Accepted"].includes(assignment.status)) {
      throw new AppError(409, "This delivery cannot be unassigned after pickup, or no rider is assigned.", "RIDER_CANNOT_BE_UNASSIGNED");
    }

    await client.query("DELETE FROM rider_assignments WHERE order_id = $1", [assignment.order_id]);
    await client.query(`
      INSERT INTO rider_assignment_events (order_id, rider_id, event, changed_by)
      VALUES ($1, $2, 'Unassigned', $3)
    `, [assignment.order_id, assignment.rider_id, `admin:${request.auth.email}`]);
    await client.query("COMMIT");
    transactionStarted = false;
    response.json({orderNumber: orderNumber.data, riderId: null});
  } catch (error) {
    if (transactionStarted) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

router.patch("/orders/:orderNumber/status", asyncHandler(async (request, response) => {
  const orderNumber = z.string().min(10).max(40).safeParse(request.params.orderNumber);
  const parsed = z.object({status: z.enum(statuses)}).safeParse(request.body);

  if (!orderNumber.success || !parsed.success) {
    throw new AppError(400, "Provide a valid order number and status.", "INVALID_STATUS_UPDATE");
  }

  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const currentResult = await client.query(
      "SELECT id, status FROM orders WHERE order_number = $1 FOR UPDATE",
      [orderNumber.data]
    );
    const currentOrder = currentResult.rows[0];

    if (!currentOrder) {
      throw new AppError(404, "Order not found.", "ORDER_NOT_FOUND");
    }

    if (!allowedTransitions[currentOrder.status].includes(parsed.data.status)) {
      throw new AppError(409, `Cannot change order status from ${currentOrder.status} to ${parsed.data.status}.`, "INVALID_STATUS_TRANSITION");
    }

    if (["Out for delivery", "Delivered"].includes(parsed.data.status)) {
      const assignmentResult = await client.query(
        "SELECT 1 FROM rider_assignments WHERE order_id = $1",
        [currentOrder.id]
      );
      if (assignmentResult.rowCount) {
        throw new AppError(409, "The assigned rider must update this delivery status.", "RIDER_STATUS_UPDATE_REQUIRED");
      }
    }

    await client.query(
      "UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2",
      [parsed.data.status, currentOrder.id]
    );
    if (parsed.data.status === "Cancelled") {
      const assignmentResult = await client.query(
        "SELECT rider_id FROM rider_assignments WHERE order_id = $1",
        [currentOrder.id]
      );
      if (assignmentResult.rowCount) {
        await client.query(`
          INSERT INTO rider_assignment_events (order_id, rider_id, event, changed_by)
          VALUES ($1, $2, 'Unassigned', $3)
        `, [currentOrder.id, assignmentResult.rows[0].rider_id, `admin:${request.auth.email}`]);
      }
      await client.query("DELETE FROM rider_assignments WHERE order_id = $1", [currentOrder.id]);
    }
    await client.query(`
      INSERT INTO order_status_history (order_id, previous_status, new_status, changed_by)
      VALUES ($1, $2, $3, $4)
    `, [currentOrder.id, currentOrder.status, parsed.data.status, request.auth.email]);

    await client.query("COMMIT");
    transactionStarted = false;
    response.json({orderNumber: orderNumber.data, status: parsed.data.status});
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    client.release();
  }
}));

export default router;
