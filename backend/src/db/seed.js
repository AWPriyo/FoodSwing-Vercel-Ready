import {pool} from "./pool.js";

const products = [
  [1, "Chicken Burger", "Burger", 220, 260, 4.8, false, "Juicy chicken patty with fresh lettuce.", "photo-1568901346375-23c9450c58cd"],
  [2, "Beef Burger", "Burger", 290, null, 4.9, false, "Grilled beef with cheese and special sauce.", "photo-1550547660-d9450f859349"],
  [3, "Cheese Burger", "Burger", 250, null, 4.7, false, "Classic burger loaded with melted cheese.", "photo-1571091718767-18b5b1457add"],
  [4, "Margherita Pizza", "Pizza", 450, null, 4.8, true, "Classic pizza with tomato and mozzarella.", "photo-1579751626657-72bc17010498"],
  [5, "BBQ Chicken Pizza", "Pizza", 620, 690, 4.9, false, "Smoky BBQ chicken with melted cheese.", "photo-1513104890138-7c749659a591"],
  [6, "Pepperoni Pizza", "Pizza", 550, null, 4.7, false, "Pepperoni, cheese and rich tomato sauce.", "photo-1628840042765-356cda07504e"],
  [7, "Fried Chicken 4pc", "Chicken", 320, 360, 4.8, false, "Crispy golden fried chicken pieces.", "photo-1626082927389-6cd097cdc6ec"],
  [8, "Chicken Wings", "Chicken", 260, null, 4.6, false, "Spicy and crispy chicken wings.", "photo-1527477396000-e27163b481c2"],
  [9, "Grilled Chicken", "Chicken", 380, null, 4.8, false, "Tender grilled chicken with herbs.", "photo-1532550907401-a500c9a57435"],
  [10, "Kacchi Biryani", "Biriyani", 380, null, 4.9, false, "Traditional aromatic Dhaka kacchi biryani.", "images/kb.png"],
  [11, "Chicken Biriyani", "Biriyani", 260, null, 4.7, false, "Delicious chicken biryani with fragrant rice.", "photo-1631515243349-e0cb75fb8d3a"],
  [12, "Beef Tehari", "Biriyani", 300, null, 4.8, false, "Traditional beef tehari with aromatic spices.", "photo-1512058564366-18510be2db19"],
  [13, "Alfredo Pasta", "Pasta", 340, null, 4.8, true, "Creamy white sauce pasta with herbs.", "photo-1645112411341-6c4fd023714a"],
  [14, "Chicken Pasta", "Pasta", 370, null, 4.7, false, "Pasta with chicken and rich creamy sauce.", "photo-1473093295043-cdd812d0e601"],
  [15, "Spaghetti Bolognese", "Pasta", 390, null, 4.8, false, "Classic spaghetti with rich meat sauce.", "photo-1551183053-bf91a1d81141"],
  [16, "Chicken Fried Rice", "Rice and Curry", 220, null, 4.6, false, "Wok-fried rice with chicken and vegetables.", "photo-1603133872878-684f208fb84b"],
  [17, "Beef Curry Rice", "Rice and Curry", 320, null, 4.8, false, "Steamed rice with spicy beef curry.", "photo-1512058564366-18510be2db19"],
  [18, "Vegetable Fried Rice", "Rice and Curry", 180, null, 4.5, true, "Fresh vegetables tossed with fried rice.", "photo-1512058564366-18510be2db19"],
  [19, "Cold Coffee", "Drinks", 150, null, 4.7, true, "Chilled creamy coffee with ice.", "photo-1461023058943-07fcbe16d735"],
  [20, "Mango Lassi", "Drinks", 120, null, 4.8, true, "Refreshing mango yogurt drink.", "photo-1570696516188-ade861b84a49"],
  [21, "Fresh Lemonade", "Drinks", 90, null, 4.6, true, "Fresh lemon juice with a cool twist.", "images/lemonade.png"],
  [22, "Chocolate Brownie", "Desserts", 160, null, 4.9, true, "Rich chocolate brownie with a soft centre.", "photo-1606313564200-e75d5e30476c"],
  [23, "Vanilla Ice Cream", "Desserts", 120, null, 4.7, true, "Smooth and creamy vanilla ice cream.", "photo-1563805042-7684c019e1cb"],
  [24, "Chocolate Cake", "Desserts", 190, null, 4.8, true, "Moist chocolate cake with chocolate frosting.", "photo-1578985545062-69928b1d9587"]
];

const promotions = [
  ["SWING30", "percent", 3000, 15000, 0, true],
  ["FREEDEL", "free_delivery", 0, null, 0, false],
  ["COMBO50", "fixed", 5000, null, 401, false],
  ["PIZZA2", "buy_one_get_one", 0, null, 0, false]
];

try {
  for (const product of products) {
    const [id, name, category, price, oldPrice, rating, vegetarian, description, imagePath] = product;
    await pool.query(`
      INSERT INTO products (
        id, name, category, price_paisa, old_price_paisa, rating,
        is_vegetarian, description, image_path, is_available, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, NOW())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        category = EXCLUDED.category,
        price_paisa = EXCLUDED.price_paisa,
        old_price_paisa = EXCLUDED.old_price_paisa,
        rating = EXCLUDED.rating,
        is_vegetarian = EXCLUDED.is_vegetarian,
        description = EXCLUDED.description,
        image_path = EXCLUDED.image_path,
        is_available = TRUE,
        updated_at = NOW()
    `, [id, name, category, price * 100, oldPrice === null ? null : oldPrice * 100, rating, vegetarian, description, imagePath]);
  }

  for (const promotion of promotions) {
    const [code, kind, value, maxDiscount, minimumSubtotal, firstOrderOnly] = promotion;
    await pool.query(`
      INSERT INTO promotions (
        code, kind, value, max_discount_paisa, minimum_subtotal_paisa,
        first_order_only, is_active, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW())
      ON CONFLICT (code) DO UPDATE SET
        kind = EXCLUDED.kind,
        value = EXCLUDED.value,
        max_discount_paisa = EXCLUDED.max_discount_paisa,
        minimum_subtotal_paisa = EXCLUDED.minimum_subtotal_paisa,
        first_order_only = EXCLUDED.first_order_only,
        is_active = TRUE,
        updated_at = NOW()
    `, [code, kind, value, maxDiscount, minimumSubtotal * 100, firstOrderOnly]);
  }

  await pool.query(`
    SELECT setval(
      pg_get_serial_sequence('products', 'id'),
      GREATEST(COALESCE((SELECT MAX(id) FROM products), 1), 1)
    )
  `);

  console.log(`Seeded ${products.length} products and ${promotions.length} promotions.`);
} catch (error) {
  console.error("Database seeding failed:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
