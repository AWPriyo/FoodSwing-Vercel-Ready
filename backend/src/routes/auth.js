import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import {Router} from "express";
import {z} from "zod";
import {AppError} from "../errors.js";
import {pool} from "../db/pool.js";
import {asyncHandler} from "../middleware/async-handler.js";
import {
  clearSessionCookie,
  createSession,
  getSessionToken,
  hashToken,
  setSessionCookie
} from "../auth/session.js";

const router = Router();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {error: "Too many login attempts. Please try again later.", code: "RATE_LIMITED"}
});
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {error: "Too many registration attempts. Please try again later.", code: "RATE_LIMITED"}
});
const passwordSchema = z.string().min(8).max(72).refine(
  password => Buffer.byteLength(password, "utf8") <= 72,
  "Password must not exceed 72 UTF-8 bytes."
);

const registerSchema = z.object({
  name: z.string().trim().min(3).max(120),
  phone: z.string().trim().regex(/^01[3-9]\d{8}$/),
  password: passwordSchema
});

const customerLoginSchema = z.object({
  phone: z.string().trim().regex(/^01[3-9]\d{8}$/),
  password: passwordSchema
});

const adminLoginSchema = z.object({
  email: z.string().trim().email().max(254).transform(email => email.toLowerCase()),
  password: passwordSchema
});

const riderLoginSchema = z.object({
  phone: z.string().trim().regex(/^01[3-9]\d{8}$/),
  password: z.string().min(12).max(72).refine(
    password => Buffer.byteLength(password, "utf8") <= 72,
    "Password must not exceed 72 UTF-8 bytes."
  )
});

const riderRegisterSchema = z.object({
  name: z.string().trim().min(3).max(120),
  phone: z.string().trim().regex(/^01[3-9]\d{8}$/),
  password: riderLoginSchema.shape.password,
  deliveryArea: z.string().trim().min(2).max(120),
  vehicleType: z.string().trim().min(2).max(40),
  vehicleRegistration: z.string().trim().min(2).max(40)
});

function invalidInput(parsed, message, code) {
  if (!parsed.success) {
    throw new AppError(400, message, code, parsed.error.flatten());
  }
  return parsed.data;
}

async function loginCustomer(response, customer) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const session = await createSession(client, {role: "customer", id: customer.id});
    await client.query("COMMIT");
    setSessionCookie(response, session.token, session.expiresAt);
    return {role: "customer", name: customer.name, phone: customer.phone};
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function loginAdmin(response, admin) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const session = await createSession(client, {role: "admin", id: admin.id});
    await client.query("COMMIT");
    setSessionCookie(response, session.token, session.expiresAt);
    return {role: "admin", email: admin.email};
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function loginRider(response, rider) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const session = await createSession(client, {role: "rider", id: rider.id});
    await client.query("COMMIT");
    setSessionCookie(response, session.token, session.expiresAt);
    return {role: "rider", name: rider.name, phone: rider.phone, availability: rider.availability};
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

router.get("/me", asyncHandler(async (request, response) => {
  response.json({user: request.auth || null});
}));

router.post("/register", registrationLimiter, asyncHandler(async (request, response) => {
  const input = invalidInput(registerSchema.safeParse(request.body), "Please enter a valid name, phone number, and password.", "INVALID_REGISTRATION");
  const passwordHash = await bcrypt.hash(input.password, 12);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(`
      INSERT INTO customers (name, phone)
      VALUES ($1, $2)
      ON CONFLICT (phone) DO NOTHING
    `, [input.name, input.phone]);

    const customerResult = await client.query(
      "SELECT id, name, phone, password_hash FROM customers WHERE phone = $1 FOR UPDATE",
      [input.phone]
    );
    const customer = customerResult.rows[0];

    if (customer.password_hash) {
      throw new AppError(409, "An account already exists for this phone number. Please log in.", "ACCOUNT_ALREADY_EXISTS");
    }

    const updatedResult = await client.query(`
      UPDATE customers
      SET name = $1, password_hash = $2, updated_at = NOW()
      WHERE id = $3
      RETURNING id, name, phone
    `, [input.name, passwordHash, customer.id]);
    const registeredCustomer = updatedResult.rows[0];
    const session = await createSession(client, {role: "customer", id: registeredCustomer.id});
    await client.query("COMMIT");

    setSessionCookie(response, session.token, session.expiresAt);
    response.status(201).json({
      user: {role: "customer", name: registeredCustomer.name, phone: registeredCustomer.phone}
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

router.post("/login", loginLimiter, asyncHandler(async (request, response) => {
  const input = invalidInput(customerLoginSchema.safeParse(request.body), "Please enter a valid phone number and password.", "INVALID_LOGIN");
  const result = await pool.query(
    "SELECT id, name, phone, password_hash FROM customers WHERE phone = $1",
    [input.phone]
  );
  const customer = result.rows[0];

  if (!customer?.password_hash || !(await bcrypt.compare(input.password, customer.password_hash))) {
    throw new AppError(401, "Phone number or password is incorrect.", "INVALID_CREDENTIALS");
  }

  response.json({user: await loginCustomer(response, customer)});
}));

router.post("/admin/login", loginLimiter, asyncHandler(async (request, response) => {
  const input = invalidInput(adminLoginSchema.safeParse(request.body), "Please enter a valid email and password.", "INVALID_ADMIN_LOGIN");
  const result = await pool.query(
    "SELECT id, email, password_hash FROM admin_users WHERE email = $1",
    [input.email]
  );
  const admin = result.rows[0];

  if (!admin || !(await bcrypt.compare(input.password, admin.password_hash))) {
    throw new AppError(401, "Email or password is incorrect.", "INVALID_CREDENTIALS");
  }

  response.json({user: await loginAdmin(response, admin)});
}));

router.post("/rider/login", loginLimiter, asyncHandler(async (request, response) => {
  const input = invalidInput(riderLoginSchema.safeParse(request.body), "Please enter a valid phone number and password.", "INVALID_RIDER_LOGIN");
  const result = await pool.query(
    "SELECT id, name, phone, password_hash, availability FROM riders WHERE phone = $1 AND is_active = TRUE",
    [input.phone]
  );
  const rider = result.rows[0];

  if (!rider || !(await bcrypt.compare(input.password, rider.password_hash))) {
    throw new AppError(401, "Phone number or password is incorrect.", "INVALID_CREDENTIALS");
  }

  response.json({user: await loginRider(response, rider)});
}));

router.post("/rider/register", registrationLimiter, asyncHandler(async (request, response) => {
  const input = invalidInput(
    riderRegisterSchema.safeParse(request.body),
    "Enter valid rider details and a password of at least 12 characters.",
    "INVALID_RIDER_REGISTRATION"
  );
  const passwordHash = await bcrypt.hash(input.password, 12);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await client.query(`
      INSERT INTO riders (
        name, phone, password_hash, delivery_area, vehicle_type, vehicle_registration
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, name, phone, availability
    `, [
      input.name,
      input.phone,
      passwordHash,
      input.deliveryArea,
      input.vehicleType,
      input.vehicleRegistration
    ]);
    const rider = result.rows[0];
    const session = await createSession(client, {role: "rider", id: rider.id});
    await client.query("COMMIT");

    setSessionCookie(response, session.token, session.expiresAt);
    response.status(201).json({
      user: {
        role: "rider",
        name: rider.name,
        phone: rider.phone,
        availability: rider.availability
      }
    });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      throw new AppError(409, "A rider account already uses this phone number.", "RIDER_PHONE_EXISTS");
    }
    throw error;
  } finally {
    client.release();
  }
}));

router.post("/logout", asyncHandler(async (request, response) => {
  const token = getSessionToken(request);
  if (token && token.length === 64) {
    await pool.query("DELETE FROM auth_sessions WHERE token_hash = $1", [hashToken(token)]);
  }

  clearSessionCookie(response);
  response.json({success: true});
}));

export default router;
