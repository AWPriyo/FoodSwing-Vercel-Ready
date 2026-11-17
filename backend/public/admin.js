const allowedTransitions = {
  Pending: ["Confirmed", "Cancelled"],
  Confirmed: ["Preparing", "Cancelled"],
  Preparing: ["Cancelled"],
  "Out for delivery": ["Delivered"],
  Delivered: [],
  Cancelled: []
};

const $ = id => document.getElementById(id);
let orders = [];
let riders = [];
const orderHistories = new Map();

const money = amount => "৳" + Math.round(amount).toLocaleString("en-BD");

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function statusClass(status) {
  return status.toLowerCase().replaceAll(" ", "-");
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-BD", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function mapPinUrl(location) {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`;
}

function renderSummary() {
  $("total-orders").textContent = orders.length;
  $("pending-orders").textContent = orders.filter(order =>
    ["Pending", "Confirmed", "Preparing"].includes(order.status)
  ).length;
  $("recent-sales").textContent = money(orders
    .filter(order => order.status !== "Cancelled")
    .reduce((total, order) => total + order.total, 0));
}

function renderOrders() {
  const search = $("order-search").value.trim().toLowerCase();
  const status = $("status-filter").value;
  const filtered = orders.filter(order => {
    const matchesStatus = status === "all" || order.status === status;
    const matchesSearch = [
      order.orderNumber,
      order.customer.name,
      order.customer.phone,
      order.deliveryAddress
    ].some(value => value.toLowerCase().includes(search));
    return matchesStatus && matchesSearch;
  });

  if (!filtered.length) {
    $("orders-list").innerHTML = `
      <div class="empty-orders">
        <i class="fas fa-inbox"></i>
        ${orders.length ? "No orders match your filters." : "No orders have been placed yet."}
      </div>`;
    return;
  }

  $("orders-list").innerHTML = filtered.map(order => {
    const nextStatuses = order.rider && order.status === "Out for delivery"
      ? []
      : allowedTransitions[order.status] || [];
    const options = [order.status, ...nextStatuses].map(option => `
      <option value="${escapeHTML(option)}">${escapeHTML(option)}</option>
    `).join("");
    const itemMarkup = order.items.map(item => `
      <span>${escapeHTML(item.name)} × ${item.quantity} <strong>${money(item.total)}</strong></span>
    `).join("");
    const mapUrl = mapPinUrl(order.deliveryLocation);
    const mapMarkup = mapUrl
      ? `<a class="map-pin-link" href="${escapeHTML(mapUrl)}" target="_blank" rel="noopener noreferrer"><i class="fas fa-map-location-dot"></i> View customer map pin</a>`
      : '<span class="no-map-pin">No map pin shared</span>';
    const assignedRider = order.rider;
    const canManageAssignment = order.status === "Preparing" &&
      (!assignedRider || ["Assigned", "Accepted"].includes(assignedRider.assignmentStatus));
    const riderOptions = riders
      .filter(rider => rider.isActive &&
        (rider.availability === "available" || rider.id === assignedRider?.id) &&
        (!rider.hasActiveDelivery || rider.id === assignedRider?.id))
      .map(rider => `<option value="${rider.id}" ${rider.id === assignedRider?.id ? "selected" : ""}>${escapeHTML(rider.name)} · ${escapeHTML(rider.phone)}${rider.hasActiveDelivery && rider.id !== assignedRider?.id ? " · Busy" : ""}</option>`)
      .join("");
    const riderControl = order.status === "Preparing" ? `
      <div class="delivery-assignment">
        <div>
          <span class="detail-label">Delivery rider</span>
          <span class="detail-value">${assignedRider
            ? `${escapeHTML(assignedRider.name)} · ${escapeHTML(assignedRider.phone)} · ${escapeHTML(assignedRider.assignmentStatus)}`
            : "No rider assigned"}</span>
        </div>
        <div class="assignment-controls">
          <select data-rider-for="${escapeHTML(order.orderNumber)}" aria-label="Assign rider to ${escapeHTML(order.orderNumber)}" ${canManageAssignment ? "" : "disabled"}>
            <option value="">Choose available rider</option>${riderOptions}
          </select>
          <button type="button" data-assign-rider="${escapeHTML(order.orderNumber)}" ${canManageAssignment ? "" : "disabled"}>Assign rider</button>
          ${assignedRider && ["Assigned", "Accepted"].includes(assignedRider.assignmentStatus)
            ? `<button type="button" class="secondary-action" data-unassign-rider="${escapeHTML(order.orderNumber)}">Unassign</button>`
            : ""}
        </div>
      </div>
    ` : assignedRider ? `
      <div class="delivery-assignment">
        <span class="detail-label">Delivery rider</span>
        <span class="detail-value">${escapeHTML(assignedRider.name)} · ${escapeHTML(assignedRider.phone)} · ${escapeHTML(assignedRider.assignmentStatus)}</span>
      </div>
    ` : "";

    return `
      <article class="order-card">
        <div class="order-top">
          <div>
            <div class="order-number">${escapeHTML(order.orderNumber)}</div>
            <div class="order-date">${escapeHTML(formatDate(order.createdAt))}</div>
          </div>
          <span class="status-pill ${statusClass(order.status)}">${escapeHTML(order.status)}</span>
        </div>
        <div class="order-details">
          <div>
            <span class="detail-label">Customer</span>
            <span class="detail-value">${escapeHTML(order.customer.name)} · ${escapeHTML(order.customer.phone)}</span>
          </div>
          <div>
            <span class="detail-label">Payment</span>
            <span class="detail-value">${escapeHTML(order.paymentMethod)}</span>
          </div>
          <div>
            <span class="detail-label">Delivery address</span>
            <span class="detail-value">${escapeHTML(order.deliveryAddress)}</span>${mapMarkup}
          </div>
          <div class="order-items">
            <span class="detail-label">Items</span>
            <div class="order-items-list">${itemMarkup}</div>
          </div>
          ${riderControl}
        </div>
        <div class="order-bottom">
          <div class="order-total">${money(order.total)}<small>Subtotal ${money(order.subtotal)} · Delivery ${money(order.deliveryFee)} · Discount ${money(order.discount)}</small></div>
          <div class="order-actions">
            <button type="button" class="history-toggle" data-order-history="${escapeHTML(order.orderNumber)}" aria-expanded="false">View history</button>
            <div class="status-controls">
            <select data-status-for="${escapeHTML(order.orderNumber)}" aria-label="New status for ${escapeHTML(order.orderNumber)}">${options}</select>
            <button type="button" data-update-status="${escapeHTML(order.orderNumber)}" ${nextStatuses.length ? "" : "disabled"}>Update status</button>
            </div>
          </div>
        </div>
        <div class="order-history" data-history-for="${escapeHTML(order.orderNumber)}" hidden></div>
      </article>
    `;
  }).join("");
}

async function toggleOrderHistory(orderNumber, button) {
  const panel = document.querySelector(`[data-history-for="${CSS.escape(orderNumber)}"]`);
  if (!panel) return;
  panel.hidden = !panel.hidden;
  button.setAttribute("aria-expanded", String(!panel.hidden));
  button.textContent = panel.hidden ? "View history" : "Hide history";
  if (panel.hidden || orderHistories.has(orderNumber)) {
    if (!panel.hidden) renderOrderHistory(panel, orderHistories.get(orderNumber));
    return;
  }

  panel.innerHTML = '<p class="history-loading">Loading order timeline…</p>';
  try {
    const response = await fetch(`/api/admin/orders/${encodeURIComponent(orderNumber)}/history`);
    const result = await response.json();
    if (response.status === 401) {
      window.location.replace("/?admin=login");
      return;
    }
    if (!response.ok) throw new Error(result.error || "Could not load order history.");
    orderHistories.set(orderNumber, result.items);
    renderOrderHistory(panel, result.items);
  } catch (error) {
    panel.innerHTML = `<p class="history-error">${escapeHTML(error.message || "Unable to load order history.")}</p>`;
  }
}

function renderOrderHistory(panel, events = []) {
  if (!events.length) {
    panel.innerHTML = '<p class="history-empty">No status history is available for this order.</p>';
    return;
  }
  panel.innerHTML = `
    <h3>Order timeline</h3>
    <ol class="history-timeline">
      ${events.map(event => `
        <li>
          <span class="history-dot"></span>
          <div><strong>${escapeHTML(event.detail)}</strong><span>${escapeHTML(event.type)} · ${escapeHTML(event.riderName || event.changedBy)}</span></div>
          <time>${escapeHTML(formatDate(event.createdAt))}</time>
        </li>
      `).join("")}
    </ol>
  `;
}

function renderRiders() {
  const container = $("riders-list");
  if (!riders.length) {
    container.innerHTML = '<div class="empty-orders">No rider accounts have been created.</div>';
    return;
  }
  container.innerHTML = riders.map(rider => `
    <article class="rider-row">
      <div>
        <strong>${escapeHTML(rider.name)}</strong>
        <span>${escapeHTML(rider.phone)} · ${escapeHTML(rider.deliveryArea)}</span>
        <span>${escapeHTML(rider.vehicleType)} · ${escapeHTML(rider.vehicleRegistration)}</span>
      </div>
      <div class="rider-state">
        <span class="status-pill ${rider.isActive ? "confirmed" : "cancelled"}">${rider.isActive ? "Active" : "Disabled"}</span>
        <span class="detail-value">${rider.availability === "available" ? "Online" : "Offline"}${rider.hasActiveDelivery ? " · On delivery" : ""}</span>
        <button type="button" class="secondary-action" data-rider-active="${rider.id}" data-next-active="${!rider.isActive}">
          ${rider.isActive ? "Disable account" : "Enable account"}
        </button>
      </div>
    </article>
  `).join("");
}

async function loadRiders() {
  try {
    const response = await fetch("/api/admin/riders");
    const result = await response.json();
    if (response.status === 401) {
      window.location.replace("/?admin=login");
      return;
    }
    if (!response.ok) throw new Error(result.error || "Could not load riders.");
    riders = result.items;
    renderRiders();
    renderOrders();
  } catch (error) {
    $("dashboard-message").textContent = error.message || "Unable to load riders.";
  }
}

async function loadOrders() {
  $("dashboard-message").textContent = "";
  $("refresh-orders").disabled = true;

  try {
    const response = await fetch("/api/admin/orders?limit=100");
    const result = await response.json();

    if (response.status === 401) {
      window.location.replace("/?admin=login");
      return;
    }
    if (!response.ok) throw new Error(result.error || "Could not load orders.");

    orders = result.items;
    orderHistories.clear();
    renderSummary();
    renderOrders();
  } catch (error) {
    $("dashboard-message").textContent = error.message || "Unable to load orders.";
  } finally {
    $("refresh-orders").disabled = false;
  }
}

async function assignRider(orderNumber) {
  const select = document.querySelector(`[data-rider-for="${CSS.escape(orderNumber)}"]`);
  if (!select || !select.value) {
    $("dashboard-message").textContent = "Choose an available rider first.";
    return;
  }
  try {
    const response = await fetch(`/api/admin/orders/${encodeURIComponent(orderNumber)}/rider`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({riderId: Number(select.value)})
    });
    const result = await response.json();
    if (response.status === 401) {
      window.location.replace("/?admin=login");
      return;
    }
    if (!response.ok) throw new Error(result.error || "Could not assign rider.");
    $("dashboard-message").textContent = `Rider assigned to ${result.orderNumber}.`;
    await Promise.all([loadOrders(), loadRiders()]);
  } catch (error) {
    $("dashboard-message").textContent = error.message || "Unable to assign rider.";
  }
}

async function unassignRider(orderNumber) {
  try {
    const response = await fetch(`/api/admin/orders/${encodeURIComponent(orderNumber)}/rider`, {method: "DELETE"});
    const result = await response.json();
    if (response.status === 401) {
      window.location.replace("/?admin=login");
      return;
    }
    if (!response.ok) throw new Error(result.error || "Could not unassign rider.");
    $("dashboard-message").textContent = `Rider unassigned from ${result.orderNumber}.`;
    await Promise.all([loadOrders(), loadRiders()]);
  } catch (error) {
    $("dashboard-message").textContent = error.message || "Unable to unassign rider.";
  }
}

async function createRider(event) {
  event.preventDefault();
  const form = $("rider-create-form");
  const submitButton = form.querySelector('[type="submit"]');
  submitButton.disabled = true;
  $("dashboard-message").textContent = "";
  try {
    const response = await fetch("/api/admin/riders", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        name: $("new-rider-name").value.trim(),
        phone: $("new-rider-phone").value.trim(),
        password: $("new-rider-password").value,
        deliveryArea: $("new-rider-area").value.trim(),
        vehicleType: $("new-rider-vehicle").value.trim(),
        vehicleRegistration: $("new-rider-registration").value.trim()
      })
    });
    const result = await response.json();
    if (response.status === 401) {
      window.location.replace("/?admin=login");
      return;
    }
    if (!response.ok) throw new Error(result.error || "Could not create rider.");
    form.reset();
    $("dashboard-message").textContent = `Rider account created for ${result.rider.name}.`;
    await loadRiders();
  } catch (error) {
    $("dashboard-message").textContent = error.message || "Unable to create rider.";
  } finally {
    submitButton.disabled = false;
  }
}

async function setRiderActive(id, isActive) {
  try {
    const response = await fetch(`/api/admin/riders/${id}`, {
      method: "PATCH",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({isActive})
    });
    const result = await response.json();
    if (response.status === 401) {
      window.location.replace("/?admin=login");
      return;
    }
    if (!response.ok) throw new Error(result.error || "Could not update rider.");
    $("dashboard-message").textContent = `Rider account ${isActive ? "enabled" : "disabled"}.`;
    await Promise.all([loadRiders(), loadOrders()]);
  } catch (error) {
    $("dashboard-message").textContent = error.message || "Unable to update rider.";
  }
}

async function updateOrderStatus(orderNumber) {
  const select = document.querySelector(`[data-status-for="${CSS.escape(orderNumber)}"]`);
  const currentOrder = orders.find(order => order.orderNumber === orderNumber);
  if (!select || !currentOrder || select.value === currentOrder.status) return;

  const button = document.querySelector(`[data-update-status="${CSS.escape(orderNumber)}"]`);
  button.disabled = true;
  $("dashboard-message").textContent = "";

  try {
    const response = await fetch(`/api/admin/orders/${encodeURIComponent(orderNumber)}/status`, {
      method: "PATCH",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({status: select.value})
    });
    const result = await response.json();

    if (response.status === 401) {
      window.location.replace("/?admin=login");
      return;
    }
    if (!response.ok) throw new Error(result.error || "Could not update order status.");

    $("dashboard-message").textContent = `Order ${result.orderNumber} updated to ${result.status}.`;
    await Promise.all([loadRiders(), loadOrders()]);
  } catch (error) {
    $("dashboard-message").textContent = error.message || "Unable to update order status.";
    button.disabled = false;
  }
}

async function logout() {
  $("admin-logout").disabled = true;
  try {
    const response = await fetch("/api/auth/logout", {method: "POST"});
    if (!response.ok) throw new Error("Could not log out.");
    window.location.replace("/");
  } catch (error) {
    $("dashboard-message").textContent = error.message;
    $("admin-logout").disabled = false;
  }
}

async function initializeDashboard() {
  try {
    const response = await fetch("/api/auth/me");
    const result = await response.json();
    if (!response.ok || result.user?.role !== "admin") {
      window.location.replace("/?admin=login");
      return;
    }

    $("admin-email").textContent = result.user.email;
    await loadOrders();
    await loadRiders();
    setInterval(() => {
      if (!document.hidden) {
        loadOrders();
        loadRiders();
      }
    }, 30000);
  } catch (error) {
    $("dashboard-message").textContent = error.message || "Unable to verify your admin session.";
  }
}

$("refresh-orders").addEventListener("click", loadOrders);
$("admin-logout").addEventListener("click", logout);
$("order-search").addEventListener("input", renderOrders);
$("status-filter").addEventListener("change", renderOrders);
$("orders-list").addEventListener("click", event => {
  const button = event.target.closest("[data-update-status]");
  if (button) updateOrderStatus(button.dataset.updateStatus);
  const assignButton = event.target.closest("[data-assign-rider]");
  if (assignButton) assignRider(assignButton.dataset.assignRider);
  const unassignButton = event.target.closest("[data-unassign-rider]");
  if (unassignButton) unassignRider(unassignButton.dataset.unassignRider);
  const historyButton = event.target.closest("[data-order-history]");
  if (historyButton) toggleOrderHistory(historyButton.dataset.orderHistory, historyButton);
});
$("riders-list").addEventListener("click", event => {
  const button = event.target.closest("[data-rider-active]");
  if (button) setRiderActive(Number(button.dataset.riderActive), button.dataset.nextActive === "true");
});
$("rider-create-form").addEventListener("submit", createRider);

initializeDashboard();
