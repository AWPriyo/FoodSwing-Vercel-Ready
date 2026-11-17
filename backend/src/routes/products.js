import {Router} from "express";
import {z} from "zod";
import {asyncHandler} from "../middleware/async-handler.js";
import {pool} from "../db/pool.js";

const router = Router();

const productQuerySchema = z.object({
  category: z.string().trim().max(80).optional(),
  search: z.string().trim().max(100).optional(),
  sort: z.enum(["default", "low", "high", "rating"]).default("default")
});

const sortColumns = {
  default: "name ASC",
  low: "price_paisa ASC, name ASC",
  high: "price_paisa DESC, name ASC",
  rating: "rating DESC, name ASC"
};

router.get("/", asyncHandler(async (request, response) => {
  const parsed = productQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({error: "Invalid product filters.", code: "INVALID_FILTERS"});
    return;
  }

  const {category, search, sort} = parsed.data;
  const result = await pool.query(`
    SELECT id, name, category, price_paisa, old_price_paisa, rating,
           is_vegetarian, description, image_path
    FROM products
    WHERE is_available = TRUE
      AND ($1::text IS NULL OR category = $1)
      AND ($2::text IS NULL OR name ILIKE $2 OR description ILIKE $2 OR category ILIKE $2)
    ORDER BY ${sortColumns[sort]}
  `, [category || null, search ? `%${search}%` : null]);

  response.json({
    items: result.rows.map(product => ({
      id: product.id,
      name: product.name,
      category: product.category,
      price: Number(product.price_paisa) / 100,
      oldPrice: product.old_price_paisa === null ? null : Number(product.old_price_paisa) / 100,
      rating: Number(product.rating),
      veg: product.is_vegetarian,
      desc: product.description,
      img: product.image_path
    }))
  });
}));

router.get("/categories", asyncHandler(async (request, response) => {
  const result = await pool.query(`
    SELECT DISTINCT category
    FROM products
    WHERE is_available = TRUE
    ORDER BY category
  `);

  response.json({items: result.rows.map(row => row.category)});
}));

export default router;
