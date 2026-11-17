CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price_paisa INTEGER NOT NULL CHECK (price_paisa >= 0),
  old_price_paisa INTEGER CHECK (old_price_paisa IS NULL OR old_price_paisa >= price_paisa),
  rating NUMERIC(2, 1) NOT NULL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
  is_vegetarian BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT NOT NULL DEFAULT '',
  image_path TEXT NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS products_category_available_idx
  ON products (category, is_available);

CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone VARCHAR(11) NOT NULL UNIQUE,
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE customers ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE customers ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE IF NOT EXISTS riders (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone VARCHAR(11) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  delivery_area TEXT NOT NULL,
  vehicle_type VARCHAR(40) NOT NULL,
  vehicle_registration VARCHAR(40) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  availability VARCHAR(20) NOT NULL DEFAULT 'offline'
    CHECK (availability IN ('available', 'offline')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS riders_active_availability_idx
  ON riders (is_active, availability);

CREATE TABLE IF NOT EXISTS admin_users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  customer_id BIGINT REFERENCES customers(id) ON DELETE CASCADE,
  admin_id BIGINT REFERENCES admin_users(id) ON DELETE CASCADE,
  rider_id BIGINT REFERENCES riders(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT auth_sessions_one_user CHECK (
    num_nonnulls(customer_id, admin_id, rider_id) = 1
  )
);

ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS rider_id BIGINT REFERENCES riders(id) ON DELETE CASCADE;
ALTER TABLE auth_sessions DROP CONSTRAINT IF EXISTS auth_sessions_one_user;
ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_one_user
  CHECK (num_nonnulls(customer_id, admin_id, rider_id) = 1);

CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx
  ON auth_sessions (expires_at);

CREATE TABLE IF NOT EXISTS promotions (
  code VARCHAR(20) PRIMARY KEY,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('percent', 'fixed', 'free_delivery', 'buy_one_get_one')),
  value INTEGER NOT NULL DEFAULT 0 CHECK (value >= 0),
  max_discount_paisa INTEGER CHECK (max_discount_paisa IS NULL OR max_discount_paisa >= 0),
  minimum_subtotal_paisa INTEGER NOT NULL DEFAULT 0 CHECK (minimum_subtotal_paisa >= 0),
  first_order_only BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  order_number VARCHAR(40) NOT NULL UNIQUE,
  tracking_token_hash CHAR(64) NOT NULL,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  delivery_address TEXT NOT NULL,
  delivery_latitude NUMERIC(9, 6),
  delivery_longitude NUMERIC(9, 6),
  payment_method VARCHAR(40) NOT NULL CHECK (payment_method = 'Cash on Delivery'),
  status VARCHAR(30) NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Confirmed', 'Preparing', 'Out for delivery', 'Delivered', 'Cancelled')),
  promo_code VARCHAR(20) REFERENCES promotions(code) ON DELETE SET NULL,
  subtotal_paisa INTEGER NOT NULL CHECK (subtotal_paisa >= 0),
  delivery_fee_paisa INTEGER NOT NULL CHECK (delivery_fee_paisa >= 0),
  discount_paisa INTEGER NOT NULL CHECK (discount_paisa >= 0),
  total_paisa INTEGER NOT NULL CHECK (total_paisa >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_latitude NUMERIC(9, 6);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_longitude NUMERIC(9, 6);
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_delivery_coordinates_valid;
ALTER TABLE orders ADD CONSTRAINT orders_delivery_coordinates_valid CHECK (
  (delivery_latitude IS NULL AND delivery_longitude IS NULL) OR
  (delivery_latitude IS NOT NULL AND delivery_longitude IS NOT NULL AND
   delivery_latitude BETWEEN -90 AND 90 AND delivery_longitude BETWEEN -180 AND 180)
);

CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_created_at_idx ON orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_customer_id_idx ON orders (customer_id);

CREATE TABLE IF NOT EXISTS rider_assignments (
  order_id BIGINT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  rider_id BIGINT NOT NULL REFERENCES riders(id) ON DELETE RESTRICT,
  assigned_by BIGINT NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL DEFAULT 'Assigned'
    CHECK (status IN ('Assigned', 'Accepted', 'Picked up', 'Delivered')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  picked_up_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rider_assignments_rider_status_idx
  ON rider_assignments (rider_id, status, assigned_at DESC);

CREATE TABLE IF NOT EXISTS rider_assignment_events (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  rider_id BIGINT NOT NULL REFERENCES riders(id) ON DELETE RESTRICT,
  event VARCHAR(20) NOT NULL
    CHECK (event IN ('Assigned', 'Reassigned', 'Unassigned', 'Accepted', 'Picked up', 'Delivered')),
  changed_by VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rider_assignment_events_order_idx
  ON rider_assignment_events (order_id, created_at);
CREATE INDEX IF NOT EXISTS rider_assignment_events_rider_idx
  ON rider_assignment_events (rider_id, created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  unit_price_paisa INTEGER NOT NULL CHECK (unit_price_paisa >= 0),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  line_total_paisa INTEGER NOT NULL CHECK (line_total_paisa >= 0)
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  previous_status VARCHAR(30),
  new_status VARCHAR(30) NOT NULL,
  changed_by VARCHAR(100) NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS order_status_history_order_idx
  ON order_status_history (order_id, created_at);
