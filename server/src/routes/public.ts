/**
 * Public read-only endpoints — no auth required.
 *
 * Used by the landing page to render real generated videos as examples
 * without forcing the visitor to log in. Only exposes the minimal data
 * needed to play a finished video (title, description, finalVideoUrl).
 *
 * In-memory cache: storyboard contents rarely change once rendered, and the
 * landing page hits this endpoint 4-6× per visitor. Cache fresh for 5 min,
 * accept stale-on-error for 24 h. This eliminates ~99% of DB roundtrips and
 * keeps the page working when Supabase's pooler briefly drops (P1001).
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

type PublicScene = {
    id: string;
    sceneNumber: number;
    narration: string;
    visualDescription: string;
    manimCode: string | null;
    estimatedDuration: number;
    actualDuration: number | null;
    videoUrl: string | null;
    audioUrl: string | null;
    thumbnailUrl: string | null;
    status: string;
};

type PublicStoryboard = {
    id: string;
    title: string;
    description: string;
    finalVideoUrl: string | null;
    totalDuration: number | null;
    status: string;
    scenes: PublicScene[];
};

const FRESH_TTL_MS = 5 * 60 * 1000;        // 5 min — fully fresh window
const STALE_TTL_MS = 24 * 60 * 60 * 1000;  // 24 h — stale-on-error window
const cache = new Map<string, { value: PublicStoryboard; fetchedAt: number }>();

router.get(
    '/storyboard/:id',
    asyncHandler(async (req: Request, res: Response) => {
        const { id } = req.params;
        const now = Date.now();
        const cached = cache.get(id);

        // 1. Fully fresh hit — return immediately, skip DB entirely.
        if (cached && now - cached.fetchedAt < FRESH_TTL_MS) {
            return res.json(cached.value);
        }

        // 2. Otherwise hit the DB. On success, refresh cache.
        try {
            const sb = await prisma.storyboard.findUnique({
                where: { id },
                select: {
                    id: true,
                    title: true,
                    description: true,
                    finalVideoUrl: true,
                    totalDuration: true,
                    status: true,
                    scenes: {
                        orderBy: { sceneNumber: 'asc' },
                        select: {
                            id: true,
                            sceneNumber: true,
                            narration: true,
                            visualDescription: true,
                            manimCode: true,
                            estimatedDuration: true,
                            actualDuration: true,
                            videoUrl: true,
                            audioUrl: true,
                            thumbnailUrl: true,
                            status: true,
                        },
                    },
                },
            });
            if (!sb) {
                return res.status(404).json({ error: 'Not Found', message: 'Storyboard not found' });
            }
            if (!sb.finalVideoUrl) {
                return res.status(404).json({ error: 'Not Ready', message: 'Video not yet rendered' });
            }
            cache.set(id, { value: sb, fetchedAt: now });
            return res.json(sb);
        } catch (err: any) {
            // 3. DB unreachable (P1001) — serve stale cache if we have one
            // within the stale window. Keeps the landing page working through
            // brief pooler hiccups.
            if (cached && now - cached.fetchedAt < STALE_TTL_MS) {
                res.setHeader('X-Cache', 'stale');
                return res.json(cached.value);
            }
            // No cache to fall back on — surface a 503 so the frontend can
            // hide the card cleanly. Avoid leaking the Prisma error blob.
            console.warn(`⚠️  /api/public/storyboard/${id} — DB unreachable (${err?.code || 'unknown'})`);
            return res.status(503).json({ error: 'Service Unavailable', message: 'Database temporarily unreachable' });
        }
    })
);

export default router;
