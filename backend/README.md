# FoodSwing backend

Node.js, Express, and PostgreSQL API for the FoodSwing demo. Customer-facing HTML, CSS, JavaScript, and image assets live in `public/`.
Protected Admin and Rider HTML pages live in `src/views/`. Locally Express serves
the public directory; on Vercel, files in `public/` are served by the CDN.
Customer phone/password and admin email/password authentication use bcrypt
password hashes and expiring HTTP-only session cookies. Admins create rider
accounts; riders sign in with their phone and password.

## Requirements

- Node.js 20 or newer
- PostgreSQL 14 or newer

## Setup

1. Create a PostgreSQL database named `foodswing` (using pgAdmin or `createdb`).
2. From this directory, copy `.env.example` to `.env` and set `DATABASE_URL`.
3. Install dependencies and initialize the database:

   ```powershell
   npm install
   npm run db:init
   npm run db:seed
   npm start
   ```

4. Open `http://localhost:3000`. Do not open `index.html` directly as a file;
   the menu, login, and checkout call the API.

Existing installations should run `npm run db:init` again to add account,
session, and rider-assignment tables. This migration keeps existing guest
customers and orders.

For development, use `npm run dev`. The seed command can be run again safely;
it updates the sample products and promotions without deleting orders.

## API

- `GET /api/health`
- `GET /api/products/categories`
- `GET /api/products?category=Biriyani&search=kacchi&sort=rating`
- `POST /api/auth/register` with `{ "name", "phone", "password" }`
- `POST /api/auth/login` with `{ "phone", "password" }`
- `POST /api/auth/admin/login` with `{ "email", "password" }`
- `POST /api/auth/rider/register` with rider profile and password
- `POST /api/auth/rider/login` with `{ "phone", "password" }`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `POST /api/orders`
- `GET /api/orders/:orderNumber` with the `x-order-token` header returned when
  the order is created
- `GET /api/admin/orders` with a signed-in admin session cookie
- `GET /api/admin/orders/:orderNumber/history` for its status and rider timeline
- `PATCH /api/admin/orders/:orderNumber/status` with the same admin session
- `GET /api/admin/riders`
- `POST /api/admin/riders` with rider profile and an initial password
- `PATCH /api/admin/riders/:id` with `{ "isActive": true|false }`
- `POST /api/admin/orders/:orderNumber/rider` with `{ "riderId": 1 }`
- `DELETE /api/admin/orders/:orderNumber/rider` to unassign before pickup
- `GET /api/rider/orders` with a rider session, including completed deliveries
- `PATCH /api/rider/orders/:orderNumber/status` with `{ "status": "Accepted" | "Picked up" | "Delivered" }`
- `PATCH /api/rider/availability` with `{ "availability": "available" | "offline" }`
- `GET /admin` for the protected order dashboard
- `GET /rider` for the protected rider portal

Customer passwords must be at least 8 characters. Admin passwords must be at
least 12 characters. Passwords are stored as bcrypt hashes; random session
tokens are stored as hashes in PostgreSQL and sent only as HTTP-only,
same-site cookies. Sessions expire after seven days.

To create or update an admin account, set `ADMIN_EMAIL` and a strong
`ADMIN_PASSWORD` in `backend/.env`, then run:

```powershell
npm run db:admin
```

The command stores only a password hash. Remove `ADMIN_PASSWORD` from `.env`
after it succeeds; the server does not need it. Admins can then sign in using
the Admin tab in the Login dialog. Successful admin login opens the protected
`/admin` dashboard, where recent orders can be searched and their allowed
status transitions and a per-order history timeline. Riders can create accounts
from the Rider tab; signup activates the account, but new riders start offline
and must switch online before the admin can assign a delivery. Assignments are
available for orders in Preparing status and only to online riders without an
active delivery. The rider portal separates active deliveries from completed
delivery history and shows the customer map pin when one was shared.

Checkout optionally requests browser location permission. A shared latitude and
longitude is stored with the order and shown only in the admin and assigned
rider dashboards; customers can still place an order using the typed address
without sharing their location.

Example order request:

```json
{
  "customer": {
    "name": "Customer Name",
    "phone": "01712345678",
    "address": "House 1, Road 2, Dhaka"
  },
  "items": [
    { "productId": 10, "quantity": 2 },
    { "productId": 21, "quantity": 1 }
  ],
  "promoCode": "FREEDEL",
  "paymentMethod": "Cash on Delivery"
}
```

Prices, delivery fees, availability, and promo eligibility are recalculated by
the server. The first release accepts Cash on Delivery only; bKash/Nagad
requires a merchant payment-gateway integration before those options can be
enabled.

## Promotions

- `SWING30`: 30% off, capped at ৳150, first order per phone number.
- `FREEDEL`: waives the delivery fee.
- `COMBO50`: ৳50 off orders above ৳400.
- `PIZZA2`: buy one pizza, get the lower-priced pizza free for each pair.

Order totals are stored in paisa as integers. Guest customer phone numbers are
stored to validate first-order promotions and associate orders; protect the
database and define a retention policy before using real customer data.


## Vercel deployment

Set Vercel's Root Directory to `backend`. Vercel detects the Express app exported
from `src/app.js`. Add `DATABASE_URL` and `DB_SSL=true` as Environment Variables.
Use the Neon pooled connection string. The database scripts (`db:init`, `db:seed`,
and `db:admin`) must be run manually from a local terminal against that database.
