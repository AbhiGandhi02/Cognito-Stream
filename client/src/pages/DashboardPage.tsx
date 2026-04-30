/**
 * DashboardPage — full workspace with prompt input, scene sidebar, video player, and scene editor.
 * Ports the existing App.tsx workspace logic into a dedicated page.
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Storyboard, type Scene } from '../services/api';
import { VideoPlayer } from '../components/VideoPlayer';
import { ProgressBar } from '../components/ProgressBar';
// Editable per-scene UI (Monaco editor + textareas) — re-enable when individual scene editing is needed.
// import { SceneCard } from '../components/SceneCard';
import {
    Sparkles,
    Download,
    RefreshCcw,
    ArrowLeft,
    Zap,
    FlaskConical,
    Film,
    Code as CodeIcon,
    CheckCircle2,
} from 'lucide-react';

export function DashboardPage() {
    // ==========================================
    // STATE
    // ==========================================
    const [prompt, setPrompt] = useState('');
    const [storyboards, setStoryboards] = useState<Storyboard[]>([]);
    const [storyboard, setStoryboard] = useState<Storyboard | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string>();
    const [isConnected, setIsConnected] = useState(false);
    const navigate = useNavigate();

    // ==========================================
    // DATA FETCHING
    // ==========================================

    const fetchStoryboards = useCallback(async () => {
        try {
            const data = await api.listStoryboards({ limit: 20 });
            setStoryboards(data.data || []);
            setIsConnected(true);
        } catch {
            setIsConnected(false);
        }
    }, []);

    const refreshStoryboard = useCallback(async (id: string) => {
        try {
            const fresh = await api.getStoryboard(id);
            setStoryboard(fresh);
            setStoryboards((prev) =>
                prev.map((sb) => (sb.id === id ? fresh : sb))
            );
        } catch (err) {
            setError((err as Error).message);
        }
    }, []);

    useEffect(() => {
        fetchStoryboards();
    }, [fetchStoryboards]);


    // Auto-poll until final video is ready or pipeline fails
    useEffect(() => {
        if (!storyboard) return;
        // Stop polling if we already have the final video or status is failed
        if (storyboard.finalVideoUrl || storyboard.status === 'failed') return;
        const interval = setInterval(() => {
            refreshStoryboard(storyboard.id);
        }, 3000);
        return () => clearInterval(interval);
    }, [storyboard?.id, storyboard?.status, storyboard?.finalVideoUrl, refreshStoryboard]);

    // ==========================================
    // HANDLERS
    // ==========================================

    const handleGenerate = async () => {
        if (!prompt.trim()) return;
        setLoading(true);
        setError(undefined);
        try {
            // Two-step flow: create the storyboard in draft mode (no auto-render).
            // User reviews/edits scenes + Manim code, then clicks "Render Full Video".
            const sb = await api.createStoryboard({ prompt, autoGenerate: false });
            setStoryboard(sb);
            setPrompt('');
            setStoryboards((prev) => [sb, ...prev]);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    };

    const handleRenderFull = async () => {
        if (!storyboard) return;
        setError(undefined);
        try {
            const updated = await api.renderStoryboard(storyboard.id);
            setStoryboard(updated);
        } catch (err) {
            setError((err as Error).message);
        }
    };

    const handleSceneUpdated = (updated: Scene) => {
        setStoryboard((prev) =>
            prev
                ? {
                    ...prev,
                    scenes: prev.scenes.map((s) =>
                        s.id === updated.id ? { ...s, ...updated } : s
                    ),
                }
                : prev
        );
    };

    // Bulk-generate Manim code for every scene that doesn't already have one.
    // Sequential to keep the previous-scene-context fresh and to be gentle on
    // Gemini's free-tier RPM limits.
    const [generatingAll, setGeneratingAll] = useState(false);
    const [generateProgress, setGenerateProgress] = useState({ done: 0, total: 0 });

    const handleGenerateAllCode = async () => {
        if (!storyboard) return;
        setError(undefined);
        setGeneratingAll(true);
        setGenerateProgress({ done: 0, total: storyboard.scenes.length });
        try {
            for (let i = 0; i < storyboard.scenes.length; i++) {
                const scene = storyboard.scenes[i];
                const alreadyHasCode =
                    typeof scene.manimCode === 'string' &&
                    scene.manimCode.includes('class GeneratedScene');
                if (!alreadyHasCode) {
                    const updated = await api.generateSceneCode(scene.id);
                    handleSceneUpdated(updated);
                }
                setGenerateProgress({ done: i + 1, total: storyboard.scenes.length });
            }
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setGeneratingAll(false);
        }
    };

    const handleTestGenerate = async () => {
        setLoading(true);
        setError(undefined);
        try {
            const sb = await api.createTestStoryboard();
            setStoryboard(sb);
            // Don't add test storyboards to the recent projects list
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    };



    const handleSelectStoryboard = (sb: Storyboard) => {
        setStoryboard(sb);
        setError(undefined);
    };

    const handleNewStoryboard = () => {
        setStoryboard(null);
        setPrompt('');
        setError(undefined);
    };

    const handleDownload = async () => {
        if (!storyboard?.finalVideoUrl) return;
        try {
            await api.downloadVideo(
                storyboard.finalVideoUrl,
                `${storyboard.title.replace(/[^a-z0-9]/gi, '_')}.mp4`
            );
        } catch {
            setError('Download failed. Try right-clicking the video.');
        }
    };

    // ==========================================
    // COMPUTED
    // ==========================================

    const completedScenes = storyboard?.scenes.filter((s) => s.status === 'completed').length || 0;
    const totalScenes = storyboard?.scenes.length || 0;
    const progress = totalScenes > 0 ? (completedScenes / totalScenes) * 100 : 0;
    const allScenesCompleted = completedScenes === totalScenes && totalScenes > 0;

    // ==========================================
    // RENDER
    // ==========================================

    return (
        <div className="min-h-screen bg-navy-950 text-slate-100 flex flex-col">
            {/* Dashboard Header */}
            <header className="glass sticky top-0 z-50 px-6 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => navigate('/')}
                        className="p-2 rounded-lg text-slate-400 hover:text-primary-300 hover:bg-white/5 transition-colors"
                        title="Back to Home"
                    >
                        <ArrowLeft className="w-4 h-4" />
                    </button>
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-500/20">
                        <Sparkles className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h1 className="text-lg font-bold tracking-tight gradient-text">
                            Cognito Stream
                        </h1>
                        <p className="text-[10px] text-slate-500 -mt-0.5 uppercase tracking-widest">
                            Dashboard
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2 text-xs">
                    <div
                        className={`w-2 h-2 rounded-full ${isConnected
                            ? 'bg-success shadow-sm shadow-success/50'
                            : 'bg-danger shadow-sm shadow-danger/50'
                            }`}
                    />
                    <span className="text-slate-500">
                        {isConnected ? 'System Online' : 'Connecting...'}
                    </span>
                </div>
            </header>

            {!storyboard ? (
                /* ====================== PROMPT VIEW ====================== */
                <main className="flex-1 flex items-center justify-center px-4 py-16">
                    <div className="w-full max-w-2xl space-y-10">
                        {/* Hero */}
                        <div className="text-center space-y-3">
                            <h2 className="text-4xl font-bold tracking-tight">
                                <span className="gradient-text">Create</span>{' '}
                                <span className="text-slate-300">Your Animation</span>
                            </h2>
                            <p className="text-slate-500 text-lg max-w-lg mx-auto">
                                Describe any concept and watch it come alive as a narrated 2D animation.
                            </p>
                        </div>

                        {/* Prompt card */}
                        <div className="glass-card rounded-2xl p-6 space-y-4">
                            <label className="text-sm font-medium text-slate-500">
                                What would you like to learn about?
                            </label>
                            <textarea
                                className="w-full resize-none rounded-xl bg-navy-900/80 border border-primary-500/10 px-4 py-3 text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500/20 transition-all"
                                rows={4}
                                placeholder="e.g., Explain the Pythagorean theorem for middle schoolers with visual examples..."
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && e.metaKey) handleGenerate();
                                }}
                            />

                            {error && (
                                <div className="rounded-xl border border-danger/20 bg-danger/10 px-4 py-2.5 text-sm text-danger">
                                    {error}
                                </div>
                            )}

                            <button
                                className="btn-primary w-full flex items-center justify-center gap-2 py-3.5 text-base"
                                onClick={handleGenerate}
                                disabled={loading || !prompt.trim()}
                            >
                                {loading ? (
                                    <>
                                        <RefreshCcw className="w-5 h-5 animate-spin" />
                                        Generating Storyboard...
                                    </>
                                ) : (
                                    <>
                                        <Zap className="w-5 h-5" />
                                        Generate Video
                                    </>
                                )}
                            </button>

                            <button
                                className="btn-secondary w-full flex items-center justify-center gap-2 py-2.5 text-sm"
                                onClick={handleTestGenerate}
                                disabled={loading}
                            >
                                <FlaskConical className="w-4 h-4" />
                                Test Pipeline (No AI)
                            </button>

                            <p className="text-center text-[11px] text-slate-700">
                                Press ⌘+Enter to generate
                            </p>
                        </div>

                        {/* Recent projects */}
                        {storyboards.length > 0 && (
                            <div className="space-y-3">
                                <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                                    Recent Projects
                                </h3>
                                <div className="grid gap-2">
                                    {storyboards.slice(0, 5).map((sb) => (
                                        <button
                                            key={sb.id}
                                            onClick={() => handleSelectStoryboard(sb)}
                                            className="glass-card rounded-xl p-4 text-left group"
                                        >
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm font-medium text-slate-300 group-hover:text-primary-300 transition-colors truncate">
                                                    {sb.title || 'Untitled'}
                                                </span>
                                                <span className="text-[10px] text-slate-600">
                                                    {sb.scenes?.length || 0} scenes
                                                </span>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </main>
            ) : storyboard.status === 'draft' ? (
                /* ====================== REVIEW VIEW (compact list) ====================== */
                <main className="flex-1 px-4 py-8">
                    <div className="w-full max-w-3xl mx-auto space-y-5">
                        {/* Storyboard header */}
                        <div className="glass-card rounded-2xl p-5">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                    <p className="text-[10px] uppercase tracking-widest text-primary-400 font-semibold mb-1">
                                        Review Storyboard
                                    </p>
                                    <h2 className="text-xl font-bold text-slate-100 truncate">
                                        {storyboard.title}
                                    </h2>
                                    <p className="text-sm text-slate-500 mt-1 line-clamp-2">
                                        {storyboard.description}
                                    </p>
                                </div>
                                <button
                                    onClick={handleNewStoryboard}
                                    className="text-xs text-slate-500 hover:text-slate-300 px-3 py-1.5 rounded-md border border-primary-500/10 hover:border-primary-500/20 transition-colors shrink-0"
                                >
                                    Discard
                                </button>
                            </div>
                            <p className="text-xs text-slate-600 mt-3">
                                Step 1: generate Manim code for all scenes. Step 2: render the final video.
                            </p>
                        </div>

                        {/* Error */}
                        {error && (
                            <div className="rounded-xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
                                {error}
                            </div>
                        )}

                        {/* Compact scene list — one line per scene */}
                        <div className="glass-card rounded-2xl p-4 space-y-1.5">
                            {storyboard.scenes?.map((scene) => {
                                const hasCode =
                                    typeof scene.manimCode === 'string' &&
                                    scene.manimCode.includes('class GeneratedScene');
                                const isCurrentlyGenerating =
                                    generatingAll && generateProgress.done === scene.sceneNumber - 1;
                                return (
                                    <div
                                        key={scene.id}
                                        className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/[0.02] transition-colors"
                                    >
                                        <span className="shrink-0 w-6 h-6 rounded-full bg-navy-900/80 border border-primary-500/15 text-[11px] font-semibold text-primary-300 flex items-center justify-center">
                                            {scene.sceneNumber}
                                        </span>
                                        <span className="text-sm text-slate-300 truncate flex-1">
                                            {scene.visualDescription || scene.narration}
                                        </span>
                                        <span className="shrink-0 text-[11px] flex items-center gap-1">
                                            {isCurrentlyGenerating ? (
                                                <span className="text-primary-300 flex items-center gap-1">
                                                    <RefreshCcw className="w-3 h-3 animate-spin" />
                                                    Generating
                                                </span>
                                            ) : hasCode ? (
                                                <span className="text-success flex items-center gap-1">
                                                    <CheckCircle2 className="w-3 h-3" />
                                                    Code ready
                                                </span>
                                            ) : (
                                                <span className="text-slate-600">Pending</span>
                                            )}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Action bar */}
                        <div className="glass-card rounded-2xl p-5 space-y-3 sticky bottom-4">
                            {(() => {
                                const scenesWithCode = storyboard.scenes?.filter(
                                    (s) =>
                                        typeof s.manimCode === 'string' &&
                                        s.manimCode.includes('class GeneratedScene')
                                ).length || 0;
                                const total = storyboard.scenes?.length || 0;
                                const allReady = scenesWithCode === total && total > 0;

                                return (
                                    <>
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-slate-500">
                                                <span className={`font-semibold ${allReady ? 'text-success' : 'text-slate-400'}`}>
                                                    {scenesWithCode}
                                                </span>
                                                <span className="text-slate-600"> / {total} scenes have code</span>
                                            </span>
                                            {generatingAll && (
                                                <span className="text-primary-300">
                                                    Generating {generateProgress.done} / {generateProgress.total}...
                                                </span>
                                            )}
                                        </div>

                                        <div className="grid grid-cols-2 gap-3">
                                            <button
                                                onClick={handleGenerateAllCode}
                                                disabled={generatingAll || allReady}
                                                className="btn-secondary flex items-center justify-center gap-2 py-2.5 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                                            >
                                                {generatingAll ? (
                                                    <>
                                                        <RefreshCcw className="w-4 h-4 animate-spin" />
                                                        Generating...
                                                    </>
                                                ) : allReady ? (
                                                    <>
                                                        <CheckCircle2 className="w-4 h-4" />
                                                        All Code Ready
                                                    </>
                                                ) : (
                                                    <>
                                                        <CodeIcon className="w-4 h-4" />
                                                        Generate Code
                                                    </>
                                                )}
                                            </button>
                                            <button
                                                onClick={handleRenderFull}
                                                disabled={!allReady || generatingAll}
                                                className="btn-primary flex items-center justify-center gap-2 py-2.5 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                                            >
                                                <Film className="w-4 h-4" />
                                                Render Final Video
                                            </button>
                                        </div>
                                    </>
                                );
                            })()}
                        </div>
                    </div>
                </main>
            ) : (
                /* ====================== WORKSPACE — FINAL VIDEO VIEW ====================== */
                <main className="flex-1 flex items-center justify-center px-4 py-8">
                    <div className="w-full max-w-3xl space-y-6">
                        {/* Storyboard header */}
                        <div className="glass-card rounded-2xl p-5">
                            <div className="flex items-start justify-between">
                                <div className="min-w-0 flex-1">
                                    <h2 className="text-xl font-bold text-slate-100 truncate">
                                        {storyboard.title}
                                    </h2>
                                    <p className="text-sm text-slate-500 mt-1 line-clamp-2">
                                        {storyboard.description}
                                    </p>
                                </div>
                                <button
                                    onClick={() => refreshStoryboard(storyboard.id)}
                                    className="p-2 rounded-lg text-slate-500 hover:text-primary-300 hover:bg-white/5 transition-colors shrink-0"
                                    title="Refresh"
                                >
                                    <RefreshCcw className="w-4 h-4" />
                                </button>
                            </div>

                            {/* Status badge */}
                            <div className="mt-3 flex items-center gap-2">
                                <div
                                    className={`w-2 h-2 rounded-full ${storyboard.status === 'completed'
                                        ? 'bg-success shadow-sm shadow-success/50'
                                        : storyboard.status === 'processing'
                                            ? 'bg-warning shadow-sm shadow-warning/50 animate-pulse'
                                            : storyboard.status === 'failed'
                                                ? 'bg-danger shadow-sm shadow-danger/50'
                                                : 'bg-slate-600'
                                        }`}
                                />
                                <span className="text-xs text-slate-500 capitalize">
                                    {storyboard.status === 'processing'
                                        ? `Processing — ${completedScenes} / ${totalScenes} scenes`
                                        : storyboard.status}
                                </span>
                            </div>
                        </div>

                        {/* Progress bar while processing */}
                        {(storyboard.status === 'processing' || storyboard.status === 'draft') && !storyboard.finalVideoUrl && (
                            <div className="glass-card rounded-2xl p-5 space-y-4">
                                <div className="flex items-center gap-3">
                                    <RefreshCcw className="w-5 h-5 animate-spin text-primary-400" />
                                    <div>
                                        <p className="text-sm font-medium text-slate-300">
                                            {progress < 100
                                                ? 'Generating your video...'
                                                : 'Assembling final video...'}
                                        </p>
                                        <p className="text-xs text-slate-600 mt-0.5">
                                            This runs fully automatically — sit back and relax.
                                        </p>
                                    </div>
                                </div>
                                <ProgressBar
                                    progress={progress}
                                    label={`${completedScenes} / ${totalScenes} scenes complete`}
                                />
                            </div>
                        )}

                        {/* Error */}
                        {error && (
                            <div className="rounded-xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
                                {error}
                            </div>
                        )}

                        {/* Failed status */}
                        {storyboard.status === 'failed' && !storyboard.finalVideoUrl && (
                            <div className="glass-card rounded-2xl p-5 space-y-3">
                                <p className="text-sm text-danger">
                                    ❌ Video generation failed. Some scenes could not be rendered.
                                </p>
                                <button
                                    onClick={() => refreshStoryboard(storyboard.id)}
                                    className="btn-secondary text-sm px-4 py-2"
                                >
                                    <RefreshCcw className="w-4 h-4 inline mr-1" />
                                    Refresh Status
                                </button>
                            </div>
                        )}

                        {/* Scene breakdown */}
                        {storyboard.scenes && storyboard.scenes.length > 0 && (
                            <div className="glass-card rounded-2xl p-5 space-y-3">
                                <h3 className="text-sm font-semibold text-slate-400">
                                    📋 Scene Breakdown
                                </h3>
                                <div className="space-y-2">
                                    {storyboard.scenes.map((scene) => (
                                        <div
                                            key={scene.id}
                                            className="flex items-start gap-3 rounded-xl bg-navy-900/40 border border-primary-500/5 px-4 py-3"
                                        >
                                            <div className="shrink-0 mt-0.5">
                                                <div
                                                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${scene.status === 'completed'
                                                            ? 'bg-success/20 text-success'
                                                            : scene.status === 'processing'
                                                                ? 'bg-warning/20 text-warning animate-pulse'
                                                                : scene.status === 'failed'
                                                                    ? 'bg-danger/20 text-danger'
                                                                    : 'bg-slate-700 text-slate-500'
                                                        }`}
                                                >
                                                    {scene.status === 'completed' ? '✓' : scene.sceneNumber}
                                                </div>
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-xs font-medium text-slate-300 line-clamp-1">
                                                    Scene {scene.sceneNumber}
                                                </p>
                                                <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">
                                                    {scene.visualDescription || scene.narration}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Final video */}
                        {storyboard.finalVideoUrl && (
                            <div className="glass-card rounded-2xl p-5 space-y-4">
                                <h3 className="text-sm font-semibold text-slate-400">
                                    🎬 Your Video Is Ready
                                </h3>
                                <div className="space-y-3">
                                    <VideoPlayer
                                        videoUrl={storyboard.finalVideoUrl}
                                        title={storyboard.title}
                                        className="aspect-video"
                                    />
                                    <button
                                        onClick={handleDownload}
                                        className="w-full flex items-center justify-center gap-2 rounded-xl bg-success/10 border border-success/20 py-2.5 text-sm font-medium text-success hover:bg-success/15 transition-colors"
                                    >
                                        <Download className="w-4 h-4" />
                                        Download Video
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Back button */}
                        <div className="pt-2 pb-8 text-center">
                            <button
                                onClick={handleNewStoryboard}
                                className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
                            >
                                ← Create New Video
                            </button>
                        </div>
                    </div>
                </main>
            )}
        </div>
    );
}
