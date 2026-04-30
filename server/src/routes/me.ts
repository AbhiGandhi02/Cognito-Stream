/**
 * /api/me — return the current authenticated user's profile, including
 * their application role. Used by the frontend to know whether to surface
 * admin UI without baking the role into the JWT itself.
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
        // requireAuth (mounted in index.ts) guarantees req.user is set.
        const u = req.user!;
        return res.json({
            id: u.id,
            email: u.email,
            role: u.role,
        });
    })
);

export default router;
