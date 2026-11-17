export class AppError extends Error {
  constructor(statusCode, message, code = "REQUEST_ERROR", details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function errorHandler(error, request, response, next) {
  if (response.headersSent) {
    next(error);
    return;
  }

  const parsedStatus = Number.isInteger(error.statusCode) ? error.statusCode : error.status;
  const statusCode = Number.isInteger(parsedStatus) && parsedStatus >= 400 && parsedStatus < 500
    ? parsedStatus
    : 500;
  const message = error.type === "entity.too.large"
    ? "Request body is too large."
    : error.type === "entity.parse.failed"
      ? "Request body contains invalid JSON."
      : statusCode >= 500
        ? "Internal server error."
        : error.message;

  if (statusCode >= 500) {
    console.error(`${request.method} ${request.path}:`, error.message);
  }

  response.status(statusCode).json({
    error: message,
    code: error.code || (error.type === "entity.too.large" ? "REQUEST_TOO_LARGE" : "INVALID_REQUEST"),
    ...(error.details ? {details: error.details} : {})
  });
}
