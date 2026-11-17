import dotenv from "dotenv";
import {fileURLToPath} from "node:url";

dotenv.config({path: fileURLToPath(new URL("../.env", import.meta.url))});

const port = Number(process.env.PORT || 3000);
let pool;

try {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing. Configure backend/.env first.");
  }

  const [appModule, poolModule] = await Promise.all([
    import("./app.js"),
    import("./db/pool.js")
  ]);
  pool = poolModule.pool;
  await pool.query("SELECT 1");
  const server = appModule.default.listen(port, () => {
    console.log(`FoodSwing is available at http://localhost:${port}`);
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      server.close(async () => {
        await pool.end();
        process.exitCode = 0;
      });
    });
  }
} catch (error) {
  console.error("Could not start FoodSwing. Check PostgreSQL and DATABASE_URL:", error.message);
  if (pool) await pool.end();
  process.exitCode = 1;
}
