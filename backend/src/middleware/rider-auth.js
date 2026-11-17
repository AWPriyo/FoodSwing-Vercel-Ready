import {AppError} from "../errors.js";

export function requireRider(request, response, next) {
  if (request.auth?.role !== "rider") {
    next(new AppError(401, "Rider login is required.", "RIDER_LOGIN_REQUIRED"));
    return;
  }

  next();
}
