
let foods = [];

const restaurants = [
  {name:"Kacchi Bhai",cuisine:"Kacchi and traditional biryani",logo:"images/Kbhai.png"},
  {name:"KFC",cuisine:"Fried chicken and quick meals",logo:"images/KFC.png"},
  {name:"Chillox",cuisine:"Burgers and comfort food",logo:"images/Chl.png"},
  {name:"PizzaBurg",cuisine:"Pizza, burgers and more",logo:"images/Pb.png"},
  {name:"Sultan's Dine",cuisine:"Kacchi and Bangladeshi cuisine",logo:"images/SD.png"},
  {name:"ChaJoy",cuisine:"Tea, ice cream and snacks",logo:"images/Cj.png"}
];

const DELIVERY_FEE = 60;
const FREE_DELIVERY_LIMIT = 599;

let cartItems = [];
let activeCategory = "All";
let activePromo = null;
let currentUser = null;
let deliveryLocation = null;
let selectedAuthRole = "customer";
let customerAuthMode = "login";
let riderAuthMode = "login";

const $ = id => document.getElementById(id);

const money = amount => "৳" + Math.round(amount).toLocaleString("en-BD");

const imageUrl = (image, width = 500) => {
  if (image.startsWith("images/")) return image;
  return `https://images.unsplash.com/${image}?w=${width}&auto=format&fit=crop&q=80`;
};

function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  $("toast-container").appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}

function renderAuthState() {
  const signedIn = Boolean(currentUser);
  $("login-btn").textContent = signedIn
    ? currentUser.name || currentUser.email || "Account"
    : "Login";
  $("auth-forms").hidden = signedIn;
  $("auth-current").hidden = !signedIn;

  if (!signedIn) return;

  $("auth-current-name").textContent = currentUser.name || "FoodSwing Admin";
  $("auth-current-details").textContent = currentUser.role === "admin"
    ? currentUser.email
    : `${currentUser.phone} · ${currentUser.role === "rider" ? "Rider account" : "Customer account"}`;
  $("admin-auth-note").hidden = currentUser.role !== "admin";
  $("rider-auth-note").hidden = currentUser.role !== "rider";
}

function openAuth() {
  $("auth-modal").classList.add("show");
  renderAuthState();
}

function closeAuth() {
  $("auth-modal").classList.remove("show");
}

function selectAuthRole(role) {
  selectedAuthRole = role;
  document.querySelectorAll("[data-auth-role]").forEach(button => {
    button.classList.toggle("active", button.dataset.authRole === role);
  });
  $("customer-auth-panel").hidden = role !== "customer";
  $("admin-auth-form").hidden = role !== "admin";
  $("rider-auth-panel").hidden = role !== "rider";
  $("auth-title").textContent = role === "admin"
    ? "Admin login"
    : role === "rider" ? "Rider login" : "Login or create an account";
  $("auth-subtitle").textContent = role === "admin"
    ? "Manage orders and rider deliveries."
    : role === "rider" ? "Sign in or create your delivery rider account."
      : "Customer accounts use your Bangladeshi phone number.";
  $("customer-auth-message").textContent = "";
  $("admin-auth-message").textContent = "";
  $("rider-auth-message").textContent = "";
}

function selectCustomerAuthMode(mode) {
  customerAuthMode = mode;
  const registering = mode === "register";
  $("register-name-field").hidden = !registering;
  $("auth-password").autocomplete = registering ? "new-password" : "current-password";
  $("customer-auth-submit").textContent = registering ? "Create Account" : "Login";
  document.querySelectorAll("[data-customer-mode]").forEach(button => {
    button.classList.toggle("active", button.dataset.customerMode === mode);
  });
  $("customer-auth-message").textContent = "";
}

function selectRiderAuthMode(mode) {
  riderAuthMode = mode;
  const registering = mode === "register";
  $("rider-register-fields").hidden = !registering;
  ["rider-name", "rider-area", "rider-vehicle", "rider-registration"].forEach(id => {
    $(id).required = registering;
  });
  $("rider-password").autocomplete = registering ? "new-password" : "current-password";
  $("rider-auth-submit").textContent = registering ? "Create rider account" : "Rider login";
  document.querySelectorAll("[data-rider-mode]").forEach(button => {
    button.classList.toggle("active", button.dataset.riderMode === mode);
  });
  $("rider-auth-message").textContent = "";
}

async function submitCustomerAuth(event) {
  event.preventDefault();
  const message = $("customer-auth-message");
  const registering = customerAuthMode === "register";
  const submitButton = $("customer-auth-submit");
  submitButton.disabled = true;
  message.textContent = "";

  try {
    const response = await fetch(`/api/auth/${registering ? "register" : "login"}`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        name: $("auth-name").value.trim(),
        phone: $("auth-phone").value.trim(),
        password: $("auth-password").value
      })
    });
    const result = await response.json();

    if (!response.ok) throw new Error(result.error || "Could not sign in.");

    currentUser = result.user;
    renderAuthState();
    $("customer-auth-form").reset();
    showToast(registering ? "Your account has been created." : "You are now logged in.");
  } catch (error) {
    message.textContent = error.message || "Unable to contact the login service.";
  } finally {
    submitButton.disabled = false;
  }
}

async function submitAdminAuth(event) {
  event.preventDefault();
  const message = $("admin-auth-message");
  const submitButton = $("admin-auth-form").querySelector('[type="submit"]');
  submitButton.disabled = true;
  message.textContent = "";

  try {
    const response = await fetch("/api/auth/admin/login", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        email: $("admin-email").value.trim(),
        password: $("admin-password").value
      })
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.code === "INVALID_CREDENTIALS"
        ? "Email or password is incorrect. Check capitalization; this is not your PostgreSQL password."
        : result.error || "Could not sign in.");
    }

    currentUser = result.user;
    renderAuthState();
    $("admin-auth-form").reset();
    if (currentUser.role === "admin") {
      window.location.assign("/admin");
      return;
    }
    showToast("Admin login successful.");
  } catch (error) {
    message.textContent = error.message || "Unable to contact the login service.";
  } finally {
    submitButton.disabled = false;
  }
}

async function submitRiderAuth(event) {
  event.preventDefault();
  const message = $("rider-auth-message");
  const submitButton = $("rider-auth-form").querySelector('[type="submit"]');
  const registering = riderAuthMode === "register";
  submitButton.disabled = true;
  message.textContent = "";

  try {
    const response = await fetch(`/api/auth/rider/${registering ? "register" : "login"}`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        name: $("rider-name").value.trim(),
        phone: $("rider-phone").value.trim(),
        password: $("rider-password").value,
        deliveryArea: $("rider-area").value.trim(),
        vehicleType: $("rider-vehicle").value.trim(),
        vehicleRegistration: $("rider-registration").value.trim()
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not sign in.");

    currentUser = result.user;
    renderAuthState();
    $("rider-auth-form").reset();
    window.location.assign("/rider");
  } catch (error) {
    message.textContent = error.message || "Unable to contact the login service.";
  } finally {
    submitButton.disabled = false;
  }
}

async function logout() {
  try {
    const response = await fetch("/api/auth/logout", {method: "POST"});
    const result = await response.json();

    if (!response.ok) throw new Error(result.error || "Could not log out.");

    currentUser = null;
    renderAuthState();
    selectAuthRole("customer");
    selectCustomerAuthMode("login");
    showToast("You have logged out.");
  } catch (error) {
    showToast(error.message || "Unable to contact the login service.", "error");
  }
}

function saveCart() {
  try {
    localStorage.setItem("foodswing-cart", JSON.stringify(cartItems));
    localStorage.setItem("foodswing-promo", activePromo || "");
  } catch (error) {
    showToast("Unable to save your cart on this browser.", "error");
  }
}

function loadCart() {
  try {
    const saved = JSON.parse(localStorage.getItem("foodswing-cart") || "[]");
    if (Array.isArray(saved)) {
      cartItems = saved.filter(item =>
        foods.some(food => food.id === item.id) &&
        Number.isInteger(item.quantity) &&
        item.quantity > 0 &&
        item.quantity < 100
      );
    }

    const promo = localStorage.getItem("foodswing-promo");
    if (["SWING30", "FREEDEL", "COMBO50", "PIZZA2"].includes(promo)) {
      activePromo = promo;
    }
  } catch (error) {
    cartItems = [];
    activePromo = null;
  }
}

function renderFoods() {
  const search = $("food-search").value.trim().toLowerCase();
  const sort = $("sort-select").value;

  let filtered = foods.filter(food => {
    const matchesCategory =
      activeCategory === "All" || food.category === activeCategory;

    const matchesSearch =
      food.name.toLowerCase().includes(search) ||
      food.desc.toLowerCase().includes(search) ||
      food.category.toLowerCase().includes(search);

    return matchesCategory && matchesSearch;
  });

  if (sort === "low") filtered.sort((a, b) => a.price - b.price);
  if (sort === "high") filtered.sort((a, b) => b.price - a.price);
  if (sort === "rating") filtered.sort((a, b) => b.rating - a.rating);

  $("food-grid").innerHTML = filtered.map(food => `
    <article class="food-card">
      <div class="food-image">
        <img src="${imageUrl(food.img)}"
          alt="${food.name}"
          loading="lazy"
          onerror="this.hidden=true;this.nextElementSibling.hidden=false">
        <div class="food-fallback" hidden>🍽️</div>
        ${food.oldPrice ? `<span class="food-badge">SALE</span>` : ""}
        <span class="veg-tag ${food.veg ? "" : "nonveg"}">
          ${food.veg ? "Veg" : "Non-Veg"}
        </span>
      </div>
      <div class="food-info">
        <h3>${food.name}</h3>
        <p>${food.desc}</p>
        <div class="food-meta">
          <span class="rating"><i class="fas fa-star"></i> ${food.rating}</span>
          <span class="food-category">${food.category}</span>
        </div>
        <div class="food-price">
          <strong>${money(food.price)}</strong>
          ${food.oldPrice ? `<del>${money(food.oldPrice)}</del>` : ""}
        </div>
        <button class="add-btn" data-add="${food.id}">
          <i class="fas fa-plus"></i> Add to Cart
        </button>
      </div>
    </article>
  `).join("");

  $("no-results").hidden = filtered.length !== 0;
}

function renderRestaurants() {
  $("restaurant-grid").innerHTML = restaurants.map(restaurant => `
    <article class="restaurant-card">
      <div class="restaurant-logo-wrap">
        <img class="restaurant-logo" src="${restaurant.logo}" alt="${restaurant.name} logo" loading="lazy">
      </div>
      <div>
        <h3>${restaurant.name}</h3>
        <p>${restaurant.cuisine}</p>
      </div>
    </article>
  `).join("");
}

function addToCart(id) {
  const food = foods.find(item => item.id === id);
  if (!food) return;

  const existing = cartItems.find(item => item.id === id);

  if (existing) {
    existing.quantity++;
  } else {
    cartItems.push({id, quantity: 1});
  }

  saveCart();
  updateCart();
  showToast(`${food.name} added to your cart.`);
}

function changeQuantity(id, change) {
  const item = cartItems.find(product => product.id === id);
  if (!item) return;

  item.quantity += change;

  if (item.quantity <= 0) {
    removeFromCart(id);
    return;
  }

  saveCart();
  updateCart();
}

function removeFromCart(id) {
  const food = foods.find(item => item.id === id);
  cartItems = cartItems.filter(item => item.id !== id);

  saveCart();
  updateCart();

  if (food) showToast(`${food.name} removed from cart.`);
}

function clearCart() {
  cartItems = [];
  activePromo = null;
  saveCart();
  updateCart();
  showToast("Your cart has been cleared.");
}

function getSubtotal() {
  return cartItems.reduce((total, item) => {
    const food = foods.find(product => product.id === item.id);
    return total + (food ? food.price * item.quantity : 0);
  }, 0);
}

function getDiscount(subtotal, delivery) {
  if (activePromo === "SWING30") {
    if (subtotal <= 0) return 0;
    return Math.min(Math.round(subtotal * 0.30), 150);
  }

  if (activePromo === "FREEDEL") return delivery;

  if (activePromo === "COMBO50" && subtotal > 400) return 50;

  if (activePromo === "PIZZA2") {
    const pizzaPrices = cartItems.flatMap(item => {
      const food = foods.find(product => product.id === item.id);
      return food && food.category === "Pizza"
        ? Array(item.quantity).fill(food.price)
        : [];
    }).sort((a, b) => a - b);

    return pizzaPrices.reduce((discount, price, index) =>
      index % 2 === 0 && index + 1 < pizzaPrices.length ? discount + price : discount, 0);
  }

  return 0;
}

function getDelivery(subtotal) {
  return subtotal === 0 || subtotal >= FREE_DELIVERY_LIMIT ? 0 : DELIVERY_FEE;
}

function updateCart() {
  const subtotal = getSubtotal();
  const delivery = getDelivery(subtotal);
  const discount = getDiscount(subtotal, delivery);
  const total = Math.max(0, subtotal + delivery - discount);
  const itemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

  $("cart-count").textContent = itemCount;
  $("drawer-count").textContent = `(${itemCount})`;
  $("subtotal").textContent = money(subtotal);
  $("delivery-fee").textContent = delivery === 0 ? "FREE" : money(delivery);
  $("discount").textContent = "-" + money(discount);
  $("total").textContent = money(total);
  $("checkout-total").textContent = money(total);

  $("cart-items").innerHTML = cartItems.length ? cartItems.map(item => {
    const food = foods.find(product => product.id === item.id);
    if (!food) return "";

    return `
      <div class="cart-item">
        <img src="${imageUrl(food.img, 180)}"
          alt="${food.name}"
          onerror="this.hidden=true">
        <div class="cart-item-details">
          <h4>${food.name}</h4>
          <p>${money(food.price * item.quantity)}</p>
          <div class="quantity-control">
            <button data-quantity="${food.id}" data-change="-1" aria-label="Decrease quantity">−</button>
            <span>${item.quantity}</span>
            <button data-quantity="${food.id}" data-change="1" aria-label="Increase quantity">+</button>
          </div>
        </div>
        <button class="remove-item" data-remove="${food.id}" aria-label="Remove ${food.name}">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    `;
  }).join("") : `
    <div class="empty-cart">
      <i class="fas fa-basket-shopping"></i>
      <h3>Your cart is empty</h3>
      <p>Add something delicious to get started.</p>
    </div>
  `;

  $("promo-input").value = activePromo || "";
  $("promo-message").textContent = activePromo
    ? `Applied: ${activePromo}`
    : "";

  $("checkout-btn").disabled = cartItems.length === 0;
  $("checkout-btn").style.opacity = cartItems.length === 0 ? ".5" : "1";
}

function applyPromo() {
  const code = $("promo-input").value.trim().toUpperCase();
  const subtotal = getSubtotal();

  if (!code) {
    if (activePromo) {
      activePromo = null;
      saveCart();
      updateCart();
      showPromoMessage("Promo code removed.", false);
      return;
    }

    showPromoMessage("Please enter a promo code.", true);
    return;
  }

  if (subtotal === 0) {
    showPromoMessage("Add items to your cart first.", true);
    return;
  }

  if (code === "COMBO50") {
    if (subtotal <= 400) {
      showPromoMessage("COMBO50 requires an order above ৳400.", true);
      return;
    }
  } else if (code === "PIZZA2") {
    const pizzaCount = cartItems.reduce((count, item) => {
      const food = foods.find(product => product.id === item.id);
      return count + (food && food.category === "Pizza" ? item.quantity : 0);
    }, 0);
    if (pizzaCount < 2) {
      showPromoMessage("Add at least two pizzas to use PIZZA2.", true);
      return;
    }
  } else if (!["SWING30", "FREEDEL"].includes(code)) {
    showPromoMessage("Invalid promo code. Please try again.", true);
    return;
  }

  activePromo = code;
  saveCart();
  updateCart();
  showPromoMessage(`${code} applied successfully!`, false);
  showToast("Promo code applied!");
}

function showPromoMessage(message, error) {
  $("promo-message").textContent = message;
  $("promo-message").style.color = error ? "var(--primary)" : "var(--success)";
}

function openCart() {
  $("cart-drawer").classList.add("open");
  $("overlay").classList.add("show");
  document.body.style.overflow = "hidden";
}

function closeCart() {
  $("cart-drawer").classList.remove("open");
  $("overlay").classList.remove("show");
  document.body.style.overflow = "";
}

function openCheckout() {
  if (!cartItems.length) {
    showToast("Your cart is empty.", "error");
    return;
  }

  closeCart();
  $("checkout-content").hidden = false;
  $("order-success").hidden = true;
  $("checkout-modal").classList.add("show");
  $("checkout-total").textContent = $("total").textContent;
  if (currentUser?.role === "customer") {
    $("customer-name").value = currentUser.name;
    $("customer-phone").value = currentUser.phone;
  }
}

function closeCheckout() {
  $("checkout-modal").classList.remove("show");
}

function resetDeliveryPin() {
  deliveryLocation = null;
  $("delivery-pin-status").textContent = "Optional — share your current location so the rider can find you.";
  $("delivery-pin-map").hidden = true;
  $("delivery-pin-map").removeAttribute("href");
  $("clear-delivery-location").hidden = true;
}

function captureDeliveryLocation() {
  const button = $("share-delivery-location");
  const status = $("delivery-pin-status");
  if (!navigator.geolocation) {
    status.textContent = "Location sharing is not supported in this browser. Please enter your address.";
    return;
  }

  button.disabled = true;
  status.textContent = "Requesting location permission…";
  navigator.geolocation.getCurrentPosition(position => {
    const latitude = Number(position.coords.latitude.toFixed(6));
    const longitude = Number(position.coords.longitude.toFixed(6));
    deliveryLocation = {latitude, longitude};
    status.textContent = `Location pinned: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
    const mapLink = $("delivery-pin-map");
    mapLink.href = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`;
    mapLink.hidden = false;
    $("clear-delivery-location").hidden = false;
    button.disabled = false;
  }, error => {
    status.textContent = error.code === 1
      ? "Location permission was denied. Enter your delivery address or allow location access."
      : "Could not get your location. Check device location settings and try again.";
    button.disabled = false;
  }, {enableHighAccuracy: true, timeout: 15000, maximumAge: 30000});
}

function validateCheckout() {
  const name = $("customer-name").value.trim();
  const phone = $("customer-phone").value.trim();
  const address = $("customer-address").value.trim();

  $("name-error").textContent = "";
  $("phone-error").textContent = "";
  $("address-error").textContent = "";

  let valid = true;

  if (name.length < 3) {
    $("name-error").textContent = "Please enter your full name.";
    valid = false;
  }

  if (!/^01[3-9]\d{8}$/.test(phone)) {
    $("phone-error").textContent = "Enter a valid Bangladeshi number (01XXXXXXXXX).";
    valid = false;
  }

  if (address.length < 8) {
    $("address-error").textContent = "Please enter a complete delivery address.";
    valid = false;
  }

  return valid;
}

async function placeOrder(event) {
  event.preventDefault();

  if (!validateCheckout()) return;

  if (!cartItems.length) {
    showToast("Your cart is empty.", "error");
    closeCheckout();
    return;
  }

  const name = $("customer-name").value.trim();
  const phone = $("customer-phone").value.trim();
  const address = $("customer-address").value.trim();
  const payment = $("payment-method").value;
  const submitButton = $("checkout-form").querySelector('[type="submit"]');
  submitButton.disabled = true;

  try {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        customer: {name, phone, address},
        ...(deliveryLocation ? {deliveryLocation} : {}),
        items: cartItems.map(item => ({productId: item.id, quantity: item.quantity})),
        promoCode: activePromo || undefined,
        paymentMethod: payment
      })
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Your order could not be placed.");
    }

    const order = result.order;
    $("checkout-content").hidden = true;
    $("order-success").hidden = false;
    $("order-success").innerHTML = `
      <div class="success-content">
        <div class="success-icon"><i class="fas fa-check"></i></div>
        <span class="eyebrow">Order received</span>
        <h2>Thank you, ${escapeHTML(name)}!</h2>
        <p>Your order is waiting for restaurant confirmation.</p>
        <div class="order-details">
          <p><span>Order ID</span><strong>${escapeHTML(order.orderNumber)}</strong></p>
          <p><span>Status</span><strong>${escapeHTML(order.status)}</strong></p>
          <p><span>Phone</span><strong>${escapeHTML(phone)}</strong></p>
          <p><span>Delivery address</span><strong>${escapeHTML(address)}</strong></p>
          <p><span>Payment</span><strong>${escapeHTML(payment)}</strong></p>
          <hr style="border:0;border-top:1px solid #ddd;margin:10px 0">
          ${order.items.map(item => `
            <p><span>${escapeHTML(item.name)} × ${item.quantity}</span><strong>${money(item.total)}</strong></p>
          `).join("")}
          <p><span>Subtotal</span><strong>${money(order.subtotal)}</strong></p>
          <p><span>Delivery</span><strong>${order.deliveryFee === 0 ? "FREE" : money(order.deliveryFee)}</strong></p>
          <p><span>Discount</span><strong>-${money(order.discount)}</strong></p>
          <p><span>Total due</span><strong>${money(order.total)}</strong></p>
        </div>
        <button class="checkout-btn" id="finish-order">Continue Shopping</button>
      </div>
    `;

    cartItems = [];
    activePromo = null;
    saveCart();
    updateCart();

    showToast("Your order has been placed successfully!");

    $("finish-order").addEventListener("click", () => {
      closeCheckout();
      $("checkout-form").reset();
      resetDeliveryPin();
      $("name-error").textContent = "";
      $("phone-error").textContent = "";
      $("address-error").textContent = "";
      window.scrollTo({top: 0, behavior: "smooth"});
    });
  } catch (error) {
    showToast(error.message || "Unable to contact the order service.", "error");
  } finally {
    submitButton.disabled = false;
  }
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function startCountdown() {
  const endTime = new Date();
  endTime.setHours(23, 59, 59, 999);

  function update() {
    const remaining = Math.max(0, endTime.getTime() - Date.now());
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);

    $("countdown").textContent =
      [hours, minutes, seconds].map(number => String(number).padStart(2, "0")).join(" : ");
  }

  update();
  setInterval(update, 1000);
}

function setupReveal() {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  }, {threshold: 0.12});

  document.querySelectorAll(".reveal").forEach(element => observer.observe(element));
}

function setupHeroGallery() {
  const gallery = $("hero-gallery");
  const slides = [...gallery.querySelectorAll(".hero-slide")];
  const controls = [...$("home").querySelectorAll("[data-hero-slide]")];
  const titles = ["Dhaka Kacchi Biryani", "Freshly Grilled Burger", "Oven-Baked Pizza", "Fresh Lemonade"];
  let activeIndex = 0;
  let timer;

  function showSlide(index) {
    activeIndex = index;
    slides.forEach((slide, slideIndex) => {
      const active = slideIndex === activeIndex;
      slide.classList.toggle("active", active);
      slide.setAttribute("aria-hidden", String(!active));
    });
    controls.forEach((control, controlIndex) => {
      const active = controlIndex === activeIndex;
      control.classList.toggle("active", active);
      control.setAttribute("aria-pressed", String(active));
    });
    $("hero-photo-title").textContent = titles[activeIndex];
  }

  function startRotation() {
    clearInterval(timer);
    timer = setInterval(() => showSlide((activeIndex + 1) % slides.length), 5000);
  }

  controls.forEach(control => {
    control.addEventListener("click", () => {
      const index = Number(control.dataset.heroSlide);
      if (!Number.isInteger(index) || index < 0 || index >= slides.length) return;
      showSlide(index);
      startRotation();
    });
  });
  gallery.addEventListener("mouseenter", () => clearInterval(timer));
  gallery.addEventListener("mouseleave", startRotation);
  showSlide(0);
  startRotation();
}

// Category filtering
$("category-list").addEventListener("click", event => {
  const button = event.target.closest("[data-category]");
  if (!button) return;

  activeCategory = button.dataset.category;

  document.querySelectorAll(".category-chip").forEach(chip => {
    chip.classList.toggle("active", chip === button);
  });

  renderFoods();
});

// Food search and sorting
$("food-search").addEventListener("input", renderFoods);
$("sort-select").addEventListener("change", renderFoods);

// Search from navbar
$("nav-search-form").addEventListener("submit", event => {
  event.preventDefault();
  $("food-search").value = $("nav-search").value;
  activeCategory = "All";

  document.querySelectorAll(".category-chip").forEach(chip => {
    chip.classList.toggle("active", chip.dataset.category === "All");
  });

  renderFoods();
  document.querySelector("#menu").scrollIntoView({behavior: "smooth"});
});

$("nav-search").addEventListener("input", () => {
  $("food-search").value = $("nav-search").value;
  activeCategory = "All";

  document.querySelectorAll(".category-chip").forEach(chip => {
    chip.classList.toggle("active", chip.dataset.category === "All");
  });

  renderFoods();
});

// Food buttons use event delegation
$("food-grid").addEventListener("click", event => {
  const button = event.target.closest("[data-add]");
  if (button) addToCart(Number(button.dataset.add));
});

// Cart buttons use event delegation
$("cart-items").addEventListener("click", event => {
  const quantityButton = event.target.closest("[data-quantity]");
  const removeButton = event.target.closest("[data-remove]");

  if (quantityButton) {
    changeQuantity(
      Number(quantityButton.dataset.quantity),
      Number(quantityButton.dataset.change)
    );
  }

  if (removeButton) {
    removeFromCart(Number(removeButton.dataset.remove));
  }
});

// Offer copy buttons
document.querySelector(".offers-grid").addEventListener("click", async event => {
  const button = event.target.closest("[data-copy]");
  if (!button) return;

  const code = button.dataset.copy;

  try {
    await navigator.clipboard.writeText(code);
    showToast(`${code} copied to clipboard!`);
  } catch (error) {
    const temporary = document.createElement("textarea");
    temporary.value = code;
    document.body.appendChild(temporary);
    temporary.select();

    try {
      document.execCommand("copy");
      showToast(`${code} copied!`);
    } catch {
      showToast("Could not copy the code.", "error");
    }

    temporary.remove();
  }
});

// Cart controls
$("open-cart").addEventListener("click", openCart);
$("close-cart").addEventListener("click", closeCart);
$("overlay").addEventListener("click", closeCart);
$("apply-promo").addEventListener("click", applyPromo);
$("promo-input").addEventListener("keydown", event => {
  if (event.key === "Enter") applyPromo();
});
$("clear-cart").addEventListener("click", clearCart);
$("checkout-btn").addEventListener("click", openCheckout);

// Checkout controls
$("close-checkout").addEventListener("click", closeCheckout);
$("checkout-form").addEventListener("submit", placeOrder);
$("share-delivery-location").addEventListener("click", captureDeliveryLocation);
$("clear-delivery-location").addEventListener("click", resetDeliveryPin);

$("checkout-modal").addEventListener("click", event => {
  if (event.target === $("checkout-modal")) closeCheckout();
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeCart();
    closeCheckout();
    closeAuth();
  }
});

// Mobile navigation
$("menu-toggle").addEventListener("click", () => {
  const menu = $("nav-links");
  const isOpen = menu.classList.toggle("open");

  $("menu-toggle").innerHTML = isOpen
    ? '<i class="fas fa-xmark"></i>'
    : '<i class="fas fa-bars"></i>';

  $("menu-toggle").setAttribute("aria-label", isOpen ? "Close navigation menu" : "Open navigation menu");
});

$("nav-links").addEventListener("click", event => {
  if (event.target.closest("a")) {
    $("nav-links").classList.remove("open");
    $("menu-toggle").innerHTML = '<i class="fas fa-bars"></i>';
    $("menu-toggle").setAttribute("aria-label", "Open navigation menu");
  }
});

// Location search
$("location-form").addEventListener("submit", event => {
  event.preventDefault();

  const location = $("location-input").value.trim();

  if (!location) return;

  showToast(`Delivery area set to: ${location}`);
  $("food-search").focus();

  $("menu").scrollIntoView({behavior: "smooth"});
});

// Authentication
$("login-btn").addEventListener("click", openAuth);
$("admin-dashboard-link").addEventListener("click", () => window.location.assign("/admin"));
$("rider-dashboard-link").addEventListener("click", () => window.location.assign("/rider"));
$("close-auth").addEventListener("click", closeAuth);
$("auth-logout").addEventListener("click", logout);
$("auth-modal").addEventListener("click", event => {
  if (event.target === $("auth-modal")) closeAuth();
});
$("customer-auth-form").addEventListener("submit", submitCustomerAuth);
$("admin-auth-form").addEventListener("submit", submitAdminAuth);
$("rider-auth-form").addEventListener("submit", submitRiderAuth);
$("toggle-admin-password").addEventListener("click", () => {
  const passwordInput = $("admin-password");
  const isVisible = passwordInput.type === "text";
  passwordInput.type = isVisible ? "password" : "text";
  $("toggle-admin-password").setAttribute("aria-label", isVisible ? "Show password" : "Hide password");
  $("toggle-admin-password").setAttribute("aria-pressed", String(!isVisible));
  $("toggle-admin-password").innerHTML = `<i class="fas fa-eye${isVisible ? "" : "-slash"}"></i>`;
});
document.querySelectorAll("[data-auth-role]").forEach(button => {
  button.addEventListener("click", () => selectAuthRole(button.dataset.authRole));
});
document.querySelectorAll("[data-customer-mode]").forEach(button => {
  button.addEventListener("click", () => selectCustomerAuthMode(button.dataset.customerMode));
});
document.querySelectorAll("[data-rider-mode]").forEach(button => {
  button.addEventListener("click", () => selectRiderAuthMode(button.dataset.riderMode));
});

async function initializeApp() {
  renderRestaurants();
  startCountdown();
  setupHeroGallery();
  setupReveal();

  try {
    const response = await fetch("/api/products");
    const result = await response.json();

    if (!response.ok || !Array.isArray(result.items)) {
      throw new Error(result.error || "The menu service returned an invalid response.");
    }

    foods = result.items;
    loadCart();
    renderFoods();
    updateCart();

  } catch (error) {
    console.error("Menu could not be loaded:", error);
    $("no-results").hidden = false;
    showToast("Menu unavailable. Start the backend and refresh the page.", "error");
    updateCart();
  }

  try {
    const authResponse = await fetch("/api/auth/me");
    const authResult = await authResponse.json();
    if (!authResponse.ok) {
      throw new Error(authResult.error || "Could not restore the login session.");
    }

    currentUser = authResult.user;
    renderAuthState();

    if (new URLSearchParams(window.location.search).get("admin") === "login") {
      if (currentUser?.role === "admin") {
        window.location.replace("/admin");
      } else {
        openAuth();
        selectAuthRole("admin");
      }
    }
    if (new URLSearchParams(window.location.search).get("rider") === "login") {
      if (currentUser?.role === "rider") {
        window.location.replace("/rider");
      } else {
        openAuth();
        selectAuthRole("rider");
      }
    }
  } catch (error) {
    console.error("Login session could not be restored:", error);
    showToast("Could not verify your login session.", "error");
  }
}

initializeApp();
