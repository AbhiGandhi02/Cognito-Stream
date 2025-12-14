// ==========================================
// REQUEST ID MIDDLEWARE
// server/src/middleware/requestId.ts
// ==========================================

import { NextFunction } from "express";
import { Request, Response } from "express";
import { v4 as uuidv4 } from 'uuid';

export function requestId(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const id = uuidv4();
  (req as any).id = id;
  res.setHeader('X-Request-ID', id);
  next();
}