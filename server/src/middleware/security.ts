// ==========================================
// SECURITY HEADERS MIDDLEWARE
// server/src/middleware/security.ts
// ==========================================

import { Request, Response } from "express";
import { NextFunction } from "express";

export function securityHeaders(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');
  
    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
  
    // Enable XSS filter
    res.setHeader('X-XSS-Protection', '1; mode=block');
  
    // Control referrer information
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
    // Content Security Policy (adjust as needed)
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';"
    );
  
    next();
  }