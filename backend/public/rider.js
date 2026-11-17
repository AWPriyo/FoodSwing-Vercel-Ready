const $ = id => document.getElementById(id);
let deliveries = [];
let currentUser = null;
let activeDeliveryFilter = "active";

const money = amount => "৳" + Math.round(amount).toLocaleString("en-BD");
const escapeHTML = value => String(value).replace(/[&<>"']/g, character => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;"
})[character]);

function formatDate(value) {
  return new Intl.DateTimeFormat("en-BD", {dateStyle: "medium", timeStyle: "short"}).format(new Date(value));
}

function mapPinUrl(location) {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`;
}

function mapEmbedUrl(location) {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const radius = 0.006;
  const bounds = [longitude - radius, latitude - radius, longitude + radius, latitude + radius].join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bounds}&layer=mapnik&marker=${latitude},${longitude}`;
}

function renderAvailability() {
  const online = currentUser.availability === "available";
  $("availability-label").textContent = online ? "You are online and can receive orders" : "You are offline";
  $("availability-toggle").textContent = online ? "Go offline" : "Go online";
  $("availability-toggle").dataset.online = String(online);
  $("availability-toggle").disabled = false;
}

function renderDeliveries() {
  const container = $("delivery-list");
  const visibleDeliveries = deliveries.filter(delivery => activeDeliveryFilter === "history"
    ? delivery.assignmentStatus === "Delivered"
    : delivery.assignmentStatus !== "Delivered");
  $("delivery-count").textContent = `${visibleDeliveries.length} ${activeDeliveryFilter === "history" ? "completed" : "active"} order${visibleDeliveries.length === 1 ? "" : "s"}`;
  if (!visibleDeliveries.length) {
    container.innerHTML = activeDeliveryFilter === "history"
      ? '<div class="empty-deliveries"><i class="fas fa-clock-rotate-left"></i>No completed deliveries yet. Delivered orders will appear in your history.</div>'
      : '<div class="empty-deliveries"><i class="fas fa-motorcycle"></i>No active deliveries right now. New assignments will appear here automatically.</div>';
    return;
  }

  container.innerHTML = visibleDeliveries.map(delivery => {
    const nextAction = {
      Assigned: "Accepted",
      Accepted: "Picked up",
      "Picked up": "Delivered"
    }[delivery.assignmentStatus];
    const items = delivery.items.map(item => `<li>${escapeHTML(item.name)} × ${item.quantity}</li>`).join("");
    const mapUrl = mapPinUrl(delivery.deliveryLocation);
    const mapFrameUrl = mapEmbedUrl(delivery.deliveryLocation);
    const locationLink = mapUrl
      ? `<a class="delivery-map-link" href="${escapeHTML(mapUrl)}" target="_blank" rel="noopener noreferrer"><i class="fas fa-map-location-dot"></i> Open delivery pin in map</a>`
      : '<span class="delivery-map-missing">Customer did not share a map pin</span>';
    const mapFrame = mapFrameUrl
      ? `<div class="delivery-map-frame"><iframe src="${escapeHTML(mapFrameUrl)}" title="Map pin for ${escapeHTML(delivery.orderNumber)}" loading="lazy" referrerpolicy="no-referrer"></iframe></div>`
      : "";
    const button = nextAction
      ? `<button type="button" class="delivery-action" data-delivery-status="${escapeHTML(delivery.orderNumber)}" data-next-status="${escapeHTML(nextAction)}">${nextAction === "Accepted" ? "Accept delivery" : nextAction === "Picked up" ? "Mark as picked up" : "Mark as delivered"}</button>`
      : "";

    return `
      <article class="delivery-card">
        <div class="delivery-top">
          <div><div class="order-number">${escapeHTML(delivery.orderNumber)}</div><div class="order-time">Order placed ${escapeHTML(formatDate(delivery.createdAt))}</div></div>
          <span class="status-pill ${delivery.assignmentStatus === "Delivered" ? "delivered" : ""}">${escapeHTML(delivery.assignmentStatus)}</span>
        </div>
        <div class="delivery-details">
          <div><span class="detail-label">Customer</span><span class="detail-value">${escapeHTML(delivery.customer.name)} · <a href="tel:${escapeHTML(delivery.customer.phone)}">${escapeHTML(delivery.customer.phone)}</a></span></div>
          <div><span class="detail-label">Delivery address</span><span class="detail-value">${escapeHTML(delivery.deliveryAddress)}</span>${locationLink}</div>
          ${mapFrame}
          <div class="delivery-items"><span class="detail-label">Order items</span><ul>${items}</ul></div>
        </div>
        <div class="delivery-bottom"><span class="delivery-total">${delivery.assignmentStatus === "Delivered" ? "Order total" : "Cash to collect"}: ${money(delivery.total)}</span>${button}</div>
      </article>
    `;
  }).join("");
}

async function loadDeliveries() {
  $("rider-message").textContent = "";
  const refreshButton = $("refresh-deliveries");
  if (refreshButton) refreshButton.disabled = true;
  try {
    const response = await fetch("/api/rider/orders");
    const result = await response.json();
    if (response.status === 401) {
      window.location.replace("/?rider=login");
      return;
    }
    if (!response.ok) throw new Error(result.error || "Could not load assigned deliveries.");
    deliveries = result.items;
    renderDeliveries();
  } catch (error) {
    $("rider-message").textContent = error.message || "Unable to load deliveries.";
  } finally {
    if (refreshButton) refreshButton.disabled = false;
  }
}

async function updateDeliveryStatus(orderNumber, status) {
  const button = document.querySelector(`[data-delivery-status="${CSS.escape(orderNumber)}"]`);
  if (button) button.disabled = true;
  $("rider-message").textContent = "";
  try {
    const response = await fetch(`/api/rider/orders/${encodeURIComponent(orderNumber)}/status`, {
      method: "PATCH",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({status})
    });
    const result = await response.json();
    if (response.status === 401) {
      window.location.replace("/?rider=login");
      return;
    }
    if (!response.ok) throw new Error(result.error || "Could not update delivery.");
    $("rider-message").textContent = `${result.orderNumber} updated: ${result.assignmentStatus}.`;
    await loadDeliveries();
  } catch (error) {
    $("rider-message").textContent = error.message || "Unable to update delivery.";
    if (button) button.disabled = false;
  }
}

async function toggleAvailability() {
  const button = $("availability-toggle");
  const availability = currentUser.availability === "available" ? "offline" : "available";
  button.disabled = true;
  $("rider-message").textContent = "";
  try {
    const response = await fetch("/api/rider/availability", {
      method: "PATCH",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({availability})
    });
    const result = await response.json();
    if (response.status === 401) {
      window.location.replace("/?rider=login");
      return;
    }
    if (!response.ok) throw new Error(result.error || "Could not update availability.");
    currentUser.availability = result.availability;
    renderAvailability();
  } catch (error) {
    $("rider-message").textContent = error.message || "Unable to update availability.";
    button.disabled = false;
  }
}

async function logout() {
  $("rider-logout").disabled = true;
  try {
    const response = await fetch("/api/auth/logout", {method: "POST"});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not log out.");
    window.location.replace("/");
  } catch (error) {
    $("rider-message").textContent = error.message || "Unable to log out.";
    $("rider-logout").disabled = false;
  }
}

async function initializeRiderPortal() {
  try {
    const response = await fetch("/api/auth/me");
    const result = await response.json();
    if (!response.ok || result.user?.role !== "rider") {
      window.location.replace("/?rider=login");
      return;
    }
    currentUser = result.user;
    $("rider-name").textContent = currentUser.name;
    renderAvailability();
    await loadDeliveries();
  } catch (error) {
    $("rider-message").textContent = error.message || "Unable to verify your rider session.";
  }
}

$("availability-toggle").addEventListener("click", toggleAvailability);
$("refresh-deliveries").addEventListener("click", loadDeliveries);
$("rider-logout").addEventListener("click", logout);
$("delivery-toolbar").addEventListener("click", event => {
  const filterButton = event.target.closest("[data-delivery-filter]");
  if (filterButton) {
    activeDeliveryFilter = filterButton.dataset.deliveryFilter;
    document.querySelectorAll("[data-delivery-filter]").forEach(button => {
      button.classList.toggle("active", button === filterButton);
    });
    renderDeliveries();
  }
});
$("delivery-list").addEventListener("click", event => {
  const button = event.target.closest("[data-delivery-status]");
  if (button) updateDeliveryStatus(button.dataset.deliveryStatus, button.dataset.nextStatus);
});

initializeRiderPortal();
setInterval(() => {
  if (currentUser && !document.hidden) loadDeliveries();
}, 20000);
