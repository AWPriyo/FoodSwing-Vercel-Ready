import {Router} from "express";
import {z} from "zod";
import {AppError} from "../errors.js";
import {pool} from "../db/pool.js";
import {asyncHandler} from "../middleware/async-handler.js";
import {requireRider} from "../middleware/rider-auth.js";

const router = Router();
router.use(requireRider);

router.get("/orders", asyncHandler(async (request, response) => {
  const result = await pool.query(`
    SELECT o.id, o.order_number, o.status AS order_status,
           o.delivery_address, o.delivery_latitude, o.delivery_longitude,
           o.total_paisa, o.created_at,
           ra.status AS assignment_status, ra.assigned_at, ra.accepted_at,
           ra.picked_up_at, ra.delivered_at,
           c.name AS customer_name, c.phone AS customer_phone,
           COALESCE(
             json_agg(json_build_object(
               'name', oi.product_name,
               'quantity', oi.quantity
             ) ORDER BY oi.id) FILTER (WHERE oi.id IS NOT NULL),
             '[]'::json
           ) AS items
    FROM rider_assignments ra
    JOIN orders o ON o.id = ra.order_id
    JOIN customers c ON c.id = o.customer_id
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE ra.rider_id = $1
    GROUP BY o.id, ra.status, ra.assigned_at, ra.accepted_at,
             ra.picked_up_at, ra.delivered_at, c.name, c.phone
    ORDER BY CASE WHEN ra.status = 'Delivered' THEN 1 ELSE 0 END,
             ra.assigned_at DESC
    LIMIT 100
  `, [request.auth.id]);

  response.json({items: result.rows.map(order => ({
    orderNumber: order.order_number,
    orderStatus: order.order_status,
    assignmentStatus: order.assignment_status,
    deliveryAddress: order.delivery_address,
    deliveryLocation: order.delivery_latitude === null ? null : {
      latitude: Number(order.delivery_latitude),
      longitude: Number(order.delivery_longitude)
    },
    total: Number(order.total_paisa) / 100,
    createdAt: order.created_at,
    assignedAt: order.assigned_at,
    acceptedAt: order.accepted_at,
    pickedUpAt: order.picked_up_at,
    deliveredAt: order.delivered_at,
    customer: {name: order.customer_name, phone: order.customer_phone},
    items: order.items
  }))});
}));

router.patch("/availability", asyncHandler(async (request, response) => {
  const parsed = z.object({availability: z.enum(["available", "offline"])}).safeParse(request.body);
  if (!parsed.success) {
    throw new AppError(400, "Choose available or offline.", "INVALID_AVAILABILITY");
  }

  const result = await pool.query(`
    UPDATE riders SET availability = $1, updated_at = NOW()
    WHERE id = $2 AND is_active = TRUE
    RETURNING availability
  `, [parsed.data.availability, request.auth.id]);
  if (!result.rowCount) throw new AppError(401, "Rider account is inactive.", "RIDER_ACCOUNT_INACTIVE");
  response.json({availability: result.rows[0].availability});
}));

router.patch("/orders/:orderNumber/status", asyncHandler(async (request, response) => {
  const orderNumber = z.string().min(10).max(40).safeParse(request.params.orderNumber);
  const parsed = z.object({status: z.enum(["Accepted", "Picked up", "Delivered"])}).safeParse(request.body);
  if (!orderNumber.success || !parsed.success) {
    throw new AppError(400, "Provide a valid order number and delivery status.", "INVALID_DELIVERY_UPDATE");
  }

  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    const result = await client.query(`
      SELECT o.id AS order_id, o.status AS order_status,
             ra.status AS assignment_status
      FROM rider_assignments ra
      JOIN orders o ON o.id = ra.order_id
      WHERE o.order_number = $1 AND ra.rider_id = $2
      FOR UPDATE OF o, ra
    `, [orderNumber.data, request.auth.id]);
    const assignment = result.rows[0];
    if (!assignment) throw new AppError(404, "Assigned delivery not found.", "DELIVERY_NOT_FOUND");

    const expectedNext = {
      Assigned: "Accepted",
      Accepted: "Picked up",
      "Picked up": "Delivered"
    }[assignment.assignment_status];
    if (expectedNext !== parsed.data.status) {
      throw new AppError(409, `Cannot change delivery status from ${assignment.assignment_status} to ${parsed.data.status}.`, "INVALID_DELIVERY_TRANSITION");
    }

    const timestampColumn = {
      Accepted: "accepted_at",
      "Picked up": "picked_up_at",
      Delivered: "delivered_at"
    }[parsed.data.status];
    await client.query(`
      UPDATE rider_assignments
      SET status = $1, ${timestampColumn} = NOW(), updated_at = NOW()
      WHERE order_id = $2
    `, [parsed.data.status, assignment.order_id]);
    await client.query(`
      INSERT INTO rider_assignment_events (order_id, rider_id, event, changed_by)
      VALUES ($1, $2, $3, $4)
    `, [assignment.order_id, request.auth.id, parsed.data.status, `rider:${request.auth.name}`]);

    if (parsed.data.status === "Picked up" || parsed.data.status === "Delivered") {
      const newOrderStatus = parsed.data.status === "Picked up" ? "Out for delivery" : "Delivered";
      const priorOrderStatus = assignment.order_status;
      const validPriorStatus = parsed.data.status === "Picked up"
        ? priorOrderStatus === "Preparing"
        : priorOrderStatus === "Out for delivery";
      if (!validPriorStatus) {
        throw new AppError(409, "The order is no longer ready for this delivery update.", "ORDER_STATUS_MISMATCH");
      }

      await client.query(
        "UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2",
        [newOrderStatus, assignment.order_id]
      );
      await client.query(`
        INSERT INTO order_status_history (order_id, previous_status, new_status, changed_by)
        VALUES ($1, $2, $3, $4)
      `, [assignment.order_id, priorOrderStatus, newOrderStatus, `rider:${request.auth.id}`]);
    }

    await client.query("COMMIT");
    transactionStarted = false;
    response.json({
      orderNumber: orderNumber.data,
      assignmentStatus: parsed.data.status,
      orderStatus: parsed.data.status === "Picked up"
        ? "Out for delivery"
        : parsed.data.status === "Delivered" ? "Delivered" : assignment.order_status
    });
  } catch (error) {
    if (transactionStarted) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

export default router;
