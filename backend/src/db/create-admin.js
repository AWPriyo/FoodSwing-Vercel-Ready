import bcrypt from "bcryptjs";
import {z} from "zod";
import {pool} from "./pool.js";

const input = z.object({
  email: z.string().trim().email().max(254).transform(email => email.toLowerCase()),
  password: z.string().min(12).max(72).refine(
    password => Buffer.byteLength(password, "utf8") <= 72,
    "Admin password must not exceed 72 UTF-8 bytes."
  )
}).safeParse({
  email: process.env.ADMIN_EMAIL,
  password: process.env.ADMIN_PASSWORD
});

try {
  if (!input.success) {
    throw new Error("Set ADMIN_EMAIL and a strong ADMIN_PASSWORD (at least 12 characters) in backend/.env.");
  }

  const passwordHash = await bcrypt.hash(input.data.password, 12);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await client.query(`
      INSERT INTO admin_users (email, password_hash)
      VALUES ($1, $2)
      ON CONFLICT (email) DO UPDATE
        SET password_hash = EXCLUDED.password_hash, updated_at = NOW()
      RETURNING id
    `, [input.data.email, passwordHash]);
    await client.query("DELETE FROM auth_sessions WHERE admin_id = $1", [result.rows[0].id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  console.log(`Admin account ${input.data.email} is ready.`);
} catch (error) {
  console.error("Could not create admin account:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
