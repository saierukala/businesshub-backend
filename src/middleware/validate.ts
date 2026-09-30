import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';

type Schemas = { body?: ZodTypeAny; query?: ZodTypeAny; params?: ZodTypeAny };

// Usage: router.post('/x', validate({ body: mySchema }), handler)
// Parsed (and coerced) data is available as req.validated.body / .query / .params.
// A failure throws a ZodError, which the error handler turns into a 400 VALIDATION_ERROR.
export const validate =
  (schemas: Schemas): RequestHandler =>
  (req, _res, next) => {
    const validated: NonNullable<Express.Request['validated']> = {};
    for (const key of ['body', 'query', 'params'] as const) {
      const schema = schemas[key];
      if (schema) validated[key] = schema.parse(req[key]);
    }
    req.validated = validated;
    next();
  };
