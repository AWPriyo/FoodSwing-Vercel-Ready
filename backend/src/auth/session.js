import {createHash, randomBytes} from "node:crypto";
import {asyncHandler} from "../middleware/async-handler.js";
import {pool} from "../db/pool.js";

export const SESSION_COOKIE = "foodswing_session";
export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(client, user) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  const userIds = [
    user.role === "customer" ? user.id : null,
    user.role === "admin" ? user.id : null,
    user.role === "rider" ? user.id : null
  ];

  await client.query(`
    INSERT INTO auth_sessions (token_hash, customer_id, admin_id, rider_id, expires_at)
    VALUES ($1, $2, $3, $4, $5)
  `, [tokenHash, ...userIds, expiresAt]);

  return {token, expiresAt};
}

export function setSessionCookie(response, token, expiresAt) {
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt
  });
}

export function clearSessionCookie(response) {
  response.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/"
  });
}

export function getSessionToken(request) {
  const cookieHeader = request.headers.cookie || "";
  const cookie = cookieHeader.split(";").map(value => value.trim())
    .find(value => value.startsWith(`${SESSION_COOKIE}=`));

  if (!cookie) return null;

  try {
    return decodeURIComponent(cookie.slice(SESSION_COOKIE.length + 1));
  } catch {
    return null;
  }
}

export const optionalSession = asyncHandler(async (request, response, next) => {
  const token = getSessionToken(request);
  if (!token || token.length !== 64) {
    next();
    return;
  }

  const result = await pool.query(`
    SELECT s.customer_id, s.admin_id, s.rider_id,
           c.name AS customer_name, c.phone AS customer_phone,
           a.email AS admin_email,
           r.name AS rider_name, r.phone AS rider_phone,
           r.is_active AS rider_is_active, r.availability AS rider_availability
    FROM auth_sessions s
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN admin_users a ON a.id = s.admin_id
    LEFT JOIN riders r ON r.id = s.rider_id
    WHERE s.token_hash = $1 AND s.expires_at > NOW()
  `, [hashToken(token)]);

  const session = result.rows[0];
  if (session?.customer_id) {
    request.auth = {
      role: "customer",
      id: session.customer_id,
      name: session.customer_name,
      phone: session.customer_phone
    };
  } else if (session?.admin_id) {
    request.auth = {
      role: "admin",
      id: session.admin_id,
      email: session.admin_email
    };
  } else if (session?.rider_id && session.rider_is_active) {
    request.auth = {
      role: "rider",
      id: session.rider_id,
      name: session.rider_name,
      phone: session.rider_phone,
      availability: session.rider_availability
    };
  }

  next();
});
