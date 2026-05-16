/**
 * Public read-only endpoints — no auth required.
 *
 * Used by the landing page to render real generated videos as examples
 * without forcing the visitor to log in. Only exposes the minimal data
 * needed to play a finished video (title, description, finalVideoUrl).
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

/**
 * GET /api/public/storyboard/:id
 *
 * Returns just the public-safe fields. 404 if the storyboard doesn't exist
 * or hasn't finished rendering yet. Prompt / user identity / scene code are
 * intentionally NOT exposed.
 */
router.get(
    '/storyboard/:id',
    asyncHandler(async (req: Request, res: Response) => {
        const { id } = req.params;
        const sb = await prisma.storyboard.findUnique({
            where: { id },
            select: {
                id: true,
                title: true,
                description: true,
                finalVideoUrl: true,
                totalDuration: true,
                status: true,
            },
        });
        if (!sb) {
            return res.status(404).json({ error: 'Not Found', message: 'Storyboard not found' });
        }
        if (!sb.finalVideoUrl) {
            return res.status(404).json({ error: 'Not Ready', message: 'Video not yet rendered' });
        }
        return res.json(sb);
    })
);

export default router;
