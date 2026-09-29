class AppError extends Error {
  constructor(statusCode, code, message, details = undefined) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function isAppError(error) {
  return error instanceof AppError;
}

module.exports = {
  AppError,
  isAppError
};
