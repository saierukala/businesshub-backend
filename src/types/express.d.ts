// Adds `req.validated` (set by the validate middleware). Express 5 makes req.query read-only,
// so validated data lives here instead of overwriting the request.
declare global {
  namespace Express {
    interface Request {
      validated?: { body?: unknown; query?: unknown; params?: unknown };
    }
  }
}

export {};
