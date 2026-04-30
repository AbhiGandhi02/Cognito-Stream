/**
 * Supabase auth middleware.
 *
 * Verifies the Supabase JWT in the Authorization header (`Bearer <jwt>`),
 * upserts the user row on first sight, and attaches `req.user` for
 * downstream handlers.
 *
 * Verification uses the project's JWT secret (HS256) — the simplest path
 * for Supabase's default tokens. If you migrate to asymmetric keys later,
 * swap to JWKS via `jose.createRemoteJWKSet`.
 */

import type { Request, Response, NextFunction } from 'express';
import { jwtVerify } from 'jose';
import { prisma } from '../lib/prisma';

export interface AuthedUser {
    id: string;       // Supabase auth.users UUID
    email: string;
    role: 'USER' | 'ADMIN';  // application role from our User table
}

// Role promotion is handled directly in the database (UPDATE "User" SET role = 'ADMIN' ...).
// New users always start as USER; an admin must elevate them by hand.

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            user?: AuthedUser;
        }
    }
}

let cachedSecretKey: Uint8Array | null = null;

function getSecretKey(): Uint8Array {
    const secret = process.env.SUPABASE_JWT_SECRET;
    if (!secret) {
        throw new Error(
            'SUPABASE_JWT_SECRET is not set. Find it in Supabase dashboard → Project Settings → API → JWT Secret.'
        );
    }
    if (!cachedSecretKey) cachedSecretKey = new TextEncoder().encode(secret);
    return cachedSecretKey;
}

/**
 * Required-auth middleware. Rejects with 401 when the JWT is missing or
 * invalid. On success, populates req.user and ensures a User row exists.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Missing Bearer token' });
    }

    try {
        const { payload } = await jwtVerify(match[1], getSecretKey(), {
            audience: 'authenticated',
        });

        const userId = String(payload.sub || '');
        const email = String(payload.email || '');
        if (!userId || !email) {
            return res.status(401).json({ error: 'Unauthorized', message: 'JWT missing sub/email' });
        }

        // Mirror the Supabase user into our local User table so we can FK to it.
        // Idempotent — first call creates with USER role, subsequent calls
        // just refresh email + updatedAt (existing role is preserved).
        const userRow = await prisma.user.upsert({
            where: { id: userId },
            update: { email },
            create: { id: userId, email, role: 'USER' },
        });

        req.user = {
            id: userId,
            email,
            role: userRow.role,
        };
        return next();
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Token verification failed';
        return res.status(401).json({ error: 'Unauthorized', message });
    }
}

/**
 * Optional-auth middleware. Attaches req.user when a valid JWT is present,
 * does NOT reject when missing/invalid. Use for endpoints that are public
 * but personalize when logged in.
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) return next();

    try {
        const { payload } = await jwtVerify(match[1], getSecretKey(), {
            audience: 'authenticated',
        });
        const userId = String(payload.sub || '');
        const email = String(payload.email || '');
        if (userId && email) {
            const userRow = await prisma.user.upsert({
                where: { id: userId },
                update: { email },
                create: { id: userId, email, role: 'USER' },
            });
            req.user = { id: userId, email, role: userRow.role };
        }
    } catch {
        // Silently ignore — request continues unauthenticated.
    }
    return next();
}

/**
 * Gate a route to ADMIN role only. Must run AFTER requireAuth so req.user
 * is populated.
 */
export function requireAdmin(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
    }
    if (req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Forbidden', message: 'Admin role required' });
    }
    return next();
}
