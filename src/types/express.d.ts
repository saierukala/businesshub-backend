// Adds `req.validated` (set by the validate middleware). Express 5 makes req.query read-only,
// so validated data lives here instead of overwriting the request.
// `req.user` is set by requireAuth.
declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: import('@prisma/client').Role };
      validated?: { body?: unknown; query?: unknown; params?: unknown };
    }
  }
}

export {};
