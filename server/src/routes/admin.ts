/**
 * /api/admin/* — endpoints that bypass per-user filtering. All gated by
 * requireAdmin (mounted in index.ts after requireAuth).
 *
 * Routes:
 *   GET /api/admin/users           — list every user with storyboard count
 *   GET /api/admin/storyboards     — list every storyboard across users
 *   GET /api/admin/users/:id/storyboards — list one user's storyboards
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

const listQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});

/**
 * GET /api/admin/users
 * All users + how many storyboards each owns + when they last created one.
 */
router.get(
    '/users',
    asyncHandler(async (req: Request, res: Response) => {
        const query = listQuerySchema.parse(req.query);

        const [users, total] = await Promise.all([
            prisma.user.findMany({
                orderBy: { createdAt: 'desc' },
                take: query.limit,
                skip: query.offset,
                include: {
                    _count: { select: { storyboards: true } },
                    storyboards: {
                        select: { createdAt: true },
                        orderBy: { createdAt: 'desc' },
                        take: 1,
                    },
                },
            }),
            prisma.user.count(),
        ]);

        return res.json({
            data: users.map((u) => ({
                id: u.id,
                email: u.email,
                name: u.name,
                role: u.role,
                createdAt: u.createdAt,
                storyboardCount: u._count.storyboards,
                lastStoryboardAt: u.storyboards[0]?.createdAt ?? null,
            })),
            pagination: { total, limit: query.limit, offset: query.offset },
        });
    })
);

/**
 * GET /api/admin/storyboards
 * Every storyboard with diagnostic metadata. Deliberately omits videoUrl /
 * finalVideoUrl / manimCode — admins see WHAT users asked for and WHETHER
 * it worked, not the rendered video itself.
 */
router.get(
    '/storyboards',
    asyncHandler(async (req: Request, res: Response) => {
        const query = listQuerySchema.parse(req.query);

        const [storyboards, total] = await Promise.all([
            prisma.storyboard.findMany({
                orderBy: { createdAt: 'desc' },
                take: query.limit,
                skip: query.offset,
                include: {
                    user: { select: { id: true, email: true, role: true } },
                    _count: { select: { scenes: true } },
                    scenes: {
                        select: { status: true, correctionAttempts: true },
                    },
                },
            }),
            prisma.storyboard.count(),
        ]);

        return res.json({
            data: storyboards.map((sb) => {
                const failed = sb.scenes.filter((s) => s.status === 'failed').length;
                const completed = sb.scenes.filter((s) => s.status === 'completed').length;
                const totalCorrections = sb.scenes.reduce(
                    (sum, s) => sum + (s.correctionAttempts || 0),
                    0
                );
                return {
                    id: sb.id,
                    title: sb.title,
                    prompt: sb.prompt, // user's original input — primary admin signal
                    status: sb.status,
                    errorMessage: sb.errorMessage,
                    totalDuration: sb.totalDuration,
                    sceneCount: sb._count.scenes,
                    completedScenes: completed,
                    failedScenes: failed,
                    totalCorrectionAttempts: totalCorrections,
                    createdAt: sb.createdAt,
                    updatedAt: sb.updatedAt,
                    user: sb.user,
                };
            }),
            pagination: { total, limit: query.limit, offset: query.offset },
        });
    })
);

/**
 * GET /api/admin/users/:id/storyboards
 * All storyboards owned by a specific user with full per-scene diagnostics.
 * Returns prompt, narration plan, status, errorMessage, correctionAttempts —
 * NOT manimCode / videoUrl / audioUrl (admin should see the request and the
 * outcome, not the actual rendered output).
 */
router.get(
    '/users/:id/storyboards',
    asyncHandler(async (req: Request, res: Response) => {
        const { id } = req.params;

        const user = await prisma.user.findUnique({ where: { id } });
        if (!user) {
            return res.status(404).json({ error: 'Not Found', message: 'User not found' });
        }

        const storyboards = await prisma.storyboard.findMany({
            where: { userId: id },
            orderBy: { createdAt: 'desc' },
            include: {
                scenes: {
                    select: {
                        id: true,
                        sceneNumber: true,
                        status: true,
                        narration: true,
                        visualDescription: true,
                        errorMessage: true,
                        correctionAttempts: true,
                        actualDuration: true,
                        estimatedDuration: true,
                    },
                    orderBy: { sceneNumber: 'asc' },
                },
            },
        });

        return res.json({
            user: { id: user.id, email: user.email, role: user.role, createdAt: user.createdAt },
            storyboards: storyboards.map((sb) => ({
                id: sb.id,
                title: sb.title,
                prompt: sb.prompt,
                description: sb.description,
                status: sb.status,
                errorMessage: sb.errorMessage,
                totalDuration: sb.totalDuration,
                createdAt: sb.createdAt,
                updatedAt: sb.updatedAt,
                scenes: sb.scenes,
            })),
        });
    })
);

export default router;
