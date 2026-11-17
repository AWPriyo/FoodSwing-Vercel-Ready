import dotenv from "dotenv";
import {fileURLToPath} from "node:url";
import pg from "pg";

dotenv.config({path: fileURLToPath(new URL("../../.env", import.meta.url))});

const {Pool} = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing. Configure backend/.env first.");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === "true" ? {rejectUnauthorized: true} : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on("error", error => {
  console.error("Unexpected PostgreSQL pool error:", error.message);
});
