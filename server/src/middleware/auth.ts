// ==========================================
// AUTHENTICATION MIDDLEWARE
// server/src/middleware/auth.ts
// ==========================================

import { NextFunction } from "express";
import { Request, Response } from "express";

export function requireAuth(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    const authHeader = req.headers.authorization;
  
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or invalid authorization header',
      });
    }
  
    const token = authHeader.substring(7);
  
    // TODO: Implement actual JWT verification
    // For now, just check if token exists
    if (!token) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid token',
      });
    }
  
    // Attach user info to request (would come from JWT)
    (req as any).user = {
      id: 'user-id',
      email: 'user@example.com',
    };
  
  
    return next();
  }
  
  export function optionalAuth(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    const authHeader = req.headers.authorization;
  
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
  
      if (token) {
        // Attach user if valid
        (req as any).user = {
          id: 'user-id',
          email: 'user@example.com',
        };
      }
    }
  
  
    return next();
  }