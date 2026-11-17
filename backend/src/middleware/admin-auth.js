import {AppError} from "../errors.js";

export function requireAdmin(request, response, next) {
  if (request.auth?.role !== "admin") {
    next(new AppError(401, "Admin login is required.", "ADMIN_LOGIN_REQUIRED"));
    return;
  }

  next();
}
