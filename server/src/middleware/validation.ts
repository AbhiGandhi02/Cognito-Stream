// ==========================================
// VALIDATION MIDDLEWARE (Updated)
// server/src/middleware/validation.ts
// ==========================================

import { z, ZodType } from "zod";
import { Request, Response, NextFunction } from "express";

// Validate req.body
export function validateRequest(schema: ZodType<any, any, any>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation Error",
          message: "Invalid request data",
          details: error.issues.map((err) => ({
            field: err.path.join("."),
            message: err.message,
          })),
        });
      }
      next(error);
    }
  };
}

// Validate req.query
export function validateQuery(schema: ZodType<any, any, any>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.query = schema.parse(req.query);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation Error",
          message: "Invalid query parameters",
          details: error.issues.map((err) => ({
            field: err.path.join("."),
            message: err.message,
          })),
        });
      }
      next(error);
    }
  };
}
