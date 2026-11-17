import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {errorHandler} from "./errors.js";
import {asyncHandler} from "./middleware/async-handler.js";
import {optionalSession} from "./auth/session.js";
import {pool} from "./db/pool.js";
import productsRouter from "./routes/products.js";
import ordersRouter from "./routes/orders.js";
import adminRouter from "./routes/admin.js";
import authRouter from "./routes/auth.js";
import riderRouter from "./routes/rider.js";

const app = express();
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(backendRoot, "public");
const viewsRoot = path.join(backendRoot, "src", "views");

app.disable("x-powered-by");
app.use(helmet({contentSecurityPolicy: false}));
app.use(express.json({limit: "16kb"}));
app.use("/api", optionalSession);

app.get("/", (request, response) => response.sendFile(path.join(publicRoot, "index.html")));
app.get("/admin", optionalSession, (request, response) => {
  if (request.auth?.role !== "admin") {
    response.redirect("/?admin=login");
    return;
  }
  response.set("Cache-Control", "no-store");
  response.sendFile(path.join(viewsRoot, "admin.html"));
});
app.get("/rider", optionalSession, (request, response) => {
  if (request.auth?.role !== "rider") {
    response.redirect("/?rider=login");
    return;
  }
  response.set("Cache-Control", "no-store");
  response.sendFile(path.join(viewsRoot, "rider.html"));
});
// Local development serves these files through Express. On Vercel, files in
// backend/public are served directly by Vercel's CDN.
app.use(express.static(publicRoot, {index: false}));

const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {error: "Too many order attempts. Please try again later.", code: "RATE_LIMITED"}
});

app.get("/api/health", asyncHandler(async (request, response) => {
  await pool.query("SELECT 1");
  response.json({status: "ok", database: "connected"});
}));

app.use("/api/products", productsRouter);
app.use("/api/auth", authRouter);
app.use("/api/orders", orderLimiter, ordersRouter);
app.use("/api/admin", adminRouter);
app.use("/api/rider", riderRouter);

app.use("/api", (request, response) => {
  response.status(404).json({error: "API endpoint not found.", code: "NOT_FOUND"});
});

app.use((request, response) => {
  response.status(404).send("Page not found.");
});

app.use(errorHandler);

export default app;
