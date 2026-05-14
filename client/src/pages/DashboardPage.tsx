/**
 * DashboardPage — full workspace with prompt input, scene sidebar, video player, and scene editor.
 * Ports the existing App.tsx workspace logic into a dedicated page.
 */

import { useState, useEffect, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, type Storyboard, type Scene } from '../services/api';
import { VideoPlayer } from '../components/VideoPlayer';
import { CommandPalette } from '../components/CommandPalette';
import { useMe } from '../hooks/useMe';
import { useAuth } from '../contexts/AuthContext';
// Editable per-scene UI (Monaco editor + textareas) — re-enable when individual scene editing is needed.
// import { SceneCard } from '../components/SceneCard';
import {
    Sparkles,
    Download,
    RefreshCcw,
    FlaskConical,
    Film,
    Code as CodeIcon,
    CheckCircle2,
    History,
    ChevronDown,
    ArrowUp,
    MessageSquarePlus,
    PanelLeft,
    LogOut,
    LayoutGrid,
} from 'lucide-react';

// Curated prompt suggestions shown on the empty-state. Mix of physics and
// maths topics — deliberately avoids the six example videos on the landing
// page (Pythagorean theorem, Bubble Sort, Simple Pendulum, Binary Search,
// Fourier Series, Wave Interference) so each suggestion is fresh content.
const PROMPT_SUGGESTIONS = [
    "Explain Newton's three laws of motion",
    'What does a derivative actually measure?',
    'How does an electromagnetic wave travel?',
    'Visualize integration as area under a curve',
    'What is the Doppler effect?',
    'Explain matrix multiplication geometrically',
];

export function DashboardPage() {
    // ==========================================
    // STATE
    // ==========================================
    const location = useLocation();
    // Router-state entry points:
    //   initialPrompt → prefill the prompt textarea (from landing hero)
    //   resumeStoryboardId → open this storyboard on mount (from /history)
    const routeState = (location.state || {}) as { initialPrompt?: string; resumeStoryboardId?: string };
    const initialPrompt = routeState.initialPrompt ?? '';
    const resumeStoryboardId = routeState.resumeStoryboardId;
    const [prompt, setPrompt] = useState(initialPrompt);
    const [storyboards, setStoryboards] = useState<Storyboard[]>([]);
    const [storyboard, setStoryboard] = useState<Storyboard | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string>();
    const [isConnected, setIsConnected] = useState(false);
    const navigate = useNavigate();
    const { isAdmin } = useMe();
    const { user, signOut } = useAuth();

    // First-letter avatar for the bottom user card.
    const userInitial = (user?.email?.[0] || 'U').toUpperCase();
    const userEmail = user?.email || 'Signed in';

    // Sidebar collapse — narrows the rail to icons only when true.
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

    useEffect(() => {
        if (initialPrompt || resumeStoryboardId) {
            // Clear state so a refresh doesn't re-trigger the entry behavior.
            window.history.replaceState({}, '');
        }
    }, [initialPrompt, resumeStoryboardId]);

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

    // When arriving from /history with a target storyboard, open it.
    useEffect(() => {
        if (!resumeStoryboardId) return;
        let active = true;
        (async () => {
            try {
                const fresh = await api.getStoryboard(resumeStoryboardId);
                if (active) setStoryboard(fresh);
            } catch (err) {
                if (active) setError((err as Error).message);
            }
        })();
        return () => { active = false; };
    }, [resumeStoryboardId]);

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

    // Per-scene retry: re-runs the full pipeline (LLM + render + TTS) for one
    // scene that previously failed. Tracks the in-flight scene ID so we can
    // disable just that row's button while it's processing.
    const [retryingSceneId, setRetryingSceneId] = useState<string | null>(null);

    // Cmd+K command palette
    const [paletteOpen, setPaletteOpen] = useState(false);

    // Set of scene IDs whose description is currently expanded in the breakdown.
    const [expandedSceneIds, setExpandedSceneIds] = useState<Set<string>>(new Set());

    const toggleSceneExpanded = (sceneId: string) => {
        setExpandedSceneIds((prev) => {
            const next = new Set(prev);
            if (next.has(sceneId)) next.delete(sceneId);
            else next.add(sceneId);
            return next;
        });
    };

    const handleRetryScene = async (sceneId: string) => {
        if (!storyboard) return;
        setError(undefined);
        setRetryingSceneId(sceneId);
        try {
            const updated = await api.regenerateScene(sceneId);
            handleSceneUpdated(updated);
            // Refresh the whole storyboard so finalVideoUrl reassembles if all scenes are now done.
            await refreshStoryboard(storyboard.id);
        } catch (err) {
            setError(`Scene retry failed: ${(err as Error).message}`);
        } finally {
            setRetryingSceneId(null);
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



    const handleSelectStoryboard = async (sb: Storyboard) => {
        setError(undefined);
        // Show the cached row immediately so the UI feels snappy, then fetch
        // the full storyboard to populate fields the list endpoint omits
        // (narration, visualDescription, manimCode, videoUrl). Without this
        // refetch the per-scene description is blank until the user clicks
        // the manual refresh button.
        setStoryboard(sb);
        try {
            const fresh = await api.getStoryboard(sb.id);
            setStoryboard(fresh);
            setStoryboards((prev) => prev.map((s) => (s.id === fresh.id ? fresh : s)));
        } catch (err) {
            setError((err as Error).message);
        }
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

    // ==========================================
    // RENDER
    // ==========================================

    const statusDot = (status: string) => {
        switch (status) {
            case 'completed':
                return 'bg-success shadow-sm shadow-success/50';
            case 'processing':
                return 'bg-warning shadow-sm shadow-warning/50 animate-pulse';
            case 'failed':
                return 'bg-danger shadow-sm shadow-danger/50';
            default:
                return 'bg-slate-600';
        }
    };

    return (
        <div className="h-screen bg-navy-950 text-slate-100 flex flex-col overflow-hidden">
            <CommandPalette
                open={paletteOpen}
                onOpenChange={setPaletteOpen}
                storyboards={storyboards}
                activeStoryboard={storyboard}
                onSelectStoryboard={(sb) => { void handleSelectStoryboard(sb); }}
                onNewStoryboard={handleNewStoryboard}
                onRetryScene={handleRetryScene}
            />
            <div className="flex-1 flex min-h-0">
                {/* ============== LEFT SIDEBAR ============== */}
                <aside
                    className={`shrink-0 border-r border-white/5 bg-navy-950/60 flex flex-col transition-[width] duration-300 ease-out ${sidebarCollapsed ? 'w-16' : 'w-64'
                        }`}
                >
                    {/* Brand row */}
                    <div className="px-4 py-4 flex items-center justify-between">
                        <Link to="/" className="flex items-center gap-2 min-w-0 group">
                            <img
                                src="/image.png"
                                alt="Cognito Stream"
                                className="w-7 h-7 shrink-0 rounded-md object-cover"
                            />
                            {!sidebarCollapsed && (
                                <span className="text-sm font-semibold text-slate-100 tracking-tight truncate group-hover:text-white transition-colors">
                                    Cognito Stream
                                </span>
                            )}
                        </Link>
                        {!sidebarCollapsed && (
                            <button
                                onClick={() => setSidebarCollapsed(true)}
                                className="p-1.5 rounded-md text-slate-500 hover:text-slate-100 hover:bg-white/5 transition-colors"
                                title="Collapse sidebar"
                                aria-label="Collapse sidebar"
                            >
                                <PanelLeft className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                    {sidebarCollapsed && (
                        <button
                            onClick={() => setSidebarCollapsed(false)}
                            className="mx-2 mb-2 p-2 rounded-md text-slate-500 hover:text-slate-100 hover:bg-white/5 transition-colors"
                            title="Expand sidebar"
                            aria-label="Expand sidebar"
                        >
                            <PanelLeft className="w-4 h-4 mx-auto" />
                        </button>
                    )}

                    {/* Primary nav */}
                    <div className="px-2.5 space-y-1">
                        <SidebarNavItem
                            icon={<MessageSquarePlus className="w-4 h-4" />}
                            label="New Chat"
                            onClick={handleNewStoryboard}
                            collapsed={sidebarCollapsed}
                            active={!storyboard}
                        />
                        <SidebarNavItem
                            icon={<LayoutGrid className="w-4 h-4" />}
                            label="Search"
                            onClick={() => setPaletteOpen(true)}
                            collapsed={sidebarCollapsed}
                            trailing={<kbd className="text-[9px] font-mono px-1 py-0.5 rounded bg-white/5 border border-white/10 text-white/40">⌘K</kbd>}
                        />
                        {/* History entry only when collapsed — the expanded
                            sidebar shows the full list below instead. */}
                        {sidebarCollapsed && (
                            <SidebarNavItem
                                icon={<History className="w-4 h-4" />}
                                label="History"
                                onClick={() => navigate('/history')}
                                collapsed={sidebarCollapsed}
                            />
                        )}
                    </div>

                    {/* History header + list — expanded sidebar only. When
                        collapsed, the History entry in the primary nav above
                        replaces this section. */}
                    {!sidebarCollapsed && (
                        <>
                            <div className="px-4 pt-5 pb-2 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <History className="w-3.5 h-3.5 text-slate-500" />
                                    <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                                        History
                                    </h3>
                                </div>
                                <Link
                                    to="/history"
                                    className="text-[10px] text-slate-500 hover:text-slate-200 transition-colors"
                                >
                                    View all
                                </Link>
                            </div>

                            <div className="flex-1 overflow-y-auto pb-4 px-2 space-y-0.5">
                                {storyboards.length === 0 ? (
                                    <p className="px-3 py-3 text-xs text-slate-600 italic">
                                        No chats yet. Start a conversation to see it here.
                                    </p>
                                ) : (
                                    storyboards.map((sb) => (
                                        <button
                                            key={sb.id}
                                            onClick={() => handleSelectStoryboard(sb)}
                                            title={sb.title || 'Untitled'}
                                            className={`w-full text-left rounded-lg transition-colors flex items-center gap-2 px-3 py-2 ${storyboard?.id === sb.id
                                                ? 'bg-primary-500/10 text-primary-200'
                                                : 'hover:bg-white/5 text-slate-300 hover:text-slate-100'
                                                }`}
                                        >
                                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot(sb.status)}`} />
                                            <span className="text-xs font-medium truncate">
                                                {sb.title || 'Untitled'}
                                            </span>
                                        </button>
                                    ))
                                )}
                            </div>
                        </>
                    )}
                    {sidebarCollapsed && <div className="flex-1" />}

                    {/* User card (bottom) */}
                    <div className={`border-t border-white/5 ${sidebarCollapsed ? 'p-2' : 'p-3'}`}>
                        <button
                            onClick={async () => {
                                await signOut();
                                navigate('/');
                            }}
                            title={sidebarCollapsed ? `${userEmail} — sign out` : 'Sign out'}
                            className={`w-full flex items-center gap-2.5 rounded-lg border border-white/5 hover:border-white/15 hover:bg-white/5 transition-colors ${sidebarCollapsed ? 'p-1.5 justify-center' : 'p-2'
                                }`}
                        >
                            <div className="w-8 h-8 shrink-0 rounded-full bg-primary-500/20 border border-primary-500/30 flex items-center justify-center text-xs font-semibold text-primary-200">
                                {userInitial}
                            </div>
                            {!sidebarCollapsed && (
                                <>
                                    <div className="min-w-0 flex-1 text-left">
                                        <p className="text-xs font-medium text-slate-200 truncate">
                                            {userEmail.split('@')[0]}
                                        </p>
                                        <p className="text-[10px] text-slate-500 truncate">
                                            {isConnected ? 'Online' : 'Connecting…'}
                                        </p>
                                    </div>
                                    <LogOut className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                </>
                            )}
                        </button>
                    </div>
                </aside>

                {/* ============== MAIN CONTENT ============== */}
                <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
            {!storyboard ? (
                /* ====================== PROMPT VIEW (empty state) ====================== */
                <main className="flex-1 flex items-center justify-center px-6 py-16">
                    <div className="w-full max-w-3xl space-y-8">
                        {/* Hero copy */}
                        <div className="text-center space-y-2">
                            <h2 className="text-[clamp(2rem,5vw,3.5rem)] font-bold tracking-[-0.02em] leading-[1.05]">
                                What's on the <span className="gradient-text">agenda</span> today?
                            </h2>
                            <p className="text-slate-500 text-base md:text-lg">
                                Generate AI animations for any concept.
                            </p>
                        </div>

                        {/* Prompt box — same shape as the landing hero */}
                        <div className="relative rounded-2xl border border-white/10 bg-white/3 backdrop-blur-md p-4 shadow-[0_10px_40px_-15px_rgba(0,0,0,0.4)] hover:border-white/15 transition-colors">
                            <textarea
                                className="w-full resize-none bg-transparent text-slate-100 placeholder:text-slate-600 text-base focus:outline-none leading-relaxed"
                                rows={2}
                                placeholder="Ask a question (will generate video)…"
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        if (prompt.trim() && !loading) handleGenerate();
                                    }
                                }}
                            />
                            <div className="flex items-center justify-between gap-3 mt-1">
                                <span className="text-[11px] text-slate-600">
                                    Press Enter to generate · Shift+Enter for new line
                                </span>
                                <button
                                    type="button"
                                    onClick={handleGenerate}
                                    disabled={loading || !prompt.trim()}
                                    aria-label="Generate video"
                                    className="w-9 h-9 rounded-full flex items-center justify-center bg-white text-black hover:bg-white/90 transition-all shadow-[0_4px_14px_-2px_rgba(255,255,255,0.2)] disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                    {loading ? (
                                        <RefreshCcw className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <ArrowUp className="w-4 h-4" />
                                    )}
                                </button>
                            </div>
                        </div>

                        {error && (
                            <div className="rounded-xl border border-danger/20 bg-danger/10 px-4 py-2.5 text-sm text-danger">
                                {error}
                            </div>
                        )}

                        {/* Suggestions card */}
                        <div className="rounded-2xl border border-white/8 bg-white/3 backdrop-blur-md p-4 space-y-1">
                            <p className="text-xs text-slate-500 px-3 pt-1 pb-2">
                                Suggestions
                            </p>
                            {PROMPT_SUGGESTIONS.map((s) => (
                                <button
                                    key={s}
                                    onClick={() => setPrompt(s)}
                                    className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/5 transition-colors group"
                                >
                                    <LayoutGrid className="w-3.5 h-3.5 text-slate-500 shrink-0 group-hover:text-slate-300 transition-colors" />
                                    <span className="text-sm text-slate-300 group-hover:text-slate-100 transition-colors">
                                        {s}
                                    </span>
                                </button>
                            ))}
                        </div>

                        {/* Admin-only diagnostic */}
                        {isAdmin && (
                            <button
                                className="btn-secondary w-full flex items-center justify-center gap-2 py-2.5 text-sm"
                                onClick={handleTestGenerate}
                                disabled={loading}
                                title="Admin: render the hardcoded test storyboard without calling the LLM"
                            >
                                <FlaskConical className="w-4 h-4" />
                                Test Pipeline (No AI)
                            </button>
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
                                        className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/0.02 transition-colors"
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

                        {/* Generation Theater — staged progress while processing */}
                        {storyboard.status === 'processing' && !storyboard.finalVideoUrl && (() => {
                            // Pick the current stage based on what we know about the
                            // storyboard. The pipeline runs serially per scene:
                            //   draft → code-gen → render → tts → assemble.
                            // We don't get sub-scene events from the orchestrator yet,
                            // so we infer stage from completedScenes vs totalScenes.
                            const stages = [
                                { id: 'draft', label: 'Storyboard drafted', icon: '📋' },
                                { id: 'code', label: 'Writing animation code', icon: '⌨️' },
                                { id: 'render', label: 'Rendering frames', icon: '🎬' },
                                { id: 'voice', label: 'Generating narration', icon: '🎙️' },
                                { id: 'assemble', label: 'Stitching final video', icon: '🪡' },
                            ];
                            const isAssembling = progress >= 100;
                            const activeStageIdx = isAssembling ? 4 : completedScenes < totalScenes ? 2 : 4;
                            return (
                                <div className="glass-card rounded-2xl p-5 space-y-5">
                                    {/* Stage strip */}
                                    <div className="flex items-center justify-between gap-2">
                                        {stages.map((stage, idx) => {
                                            const done = idx < activeStageIdx;
                                            const active = idx === activeStageIdx;
                                            return (
                                                <div
                                                    key={stage.id}
                                                    className="flex-1 flex flex-col items-center gap-1.5 min-w-0"
                                                >
                                                    <div
                                                        className={`w-9 h-9 rounded-full flex items-center justify-center text-base transition-all ${done
                                                            ? 'bg-white/10 border border-white/30 text-white/90'
                                                            : active
                                                                ? 'bg-white/15 border border-white/50 text-white shadow-lg shadow-white/10 animate-pulse'
                                                                : 'bg-white/2 border border-white/10 text-white/30'
                                                            }`}
                                                    >
                                                        {done ? '✓' : stage.icon}
                                                    </div>
                                                    <span
                                                        className={`text-[10px] uppercase tracking-wider truncate max-w-full ${active ? 'text-white' : done ? 'text-white/50' : 'text-white/30'
                                                            }`}
                                                    >
                                                        {stage.label}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    <div className="h-px bg-white/5" />

                                    {/* Per-scene live status grid — each tile pulses while its
                                        scene is the in-flight one and fills in as scenes complete. */}
                                    <div>
                                        <div className="flex items-center justify-between mb-2.5">
                                            <p className="text-xs text-white/60 font-medium">
                                                {isAssembling ? 'Assembling final video' : `Scene ${completedScenes + 1} of ${totalScenes}`}
                                            </p>
                                            <p className="text-[11px] text-white/40 font-mono">
                                                {completedScenes} / {totalScenes}
                                            </p>
                                        </div>
                                        <div className="grid grid-cols-12 gap-1">
                                            {Array.from({ length: totalScenes }).map((_, i) => {
                                                const sceneStatus = storyboard.scenes?.[i]?.status;
                                                const isComplete = sceneStatus === 'completed';
                                                const isProcessing = sceneStatus === 'processing' || (i === completedScenes && !isAssembling);
                                                const isFailed = sceneStatus === 'failed';
                                                return (
                                                    <div
                                                        key={i}
                                                        className={`h-1.5 rounded-full transition-all ${isFailed
                                                            ? 'bg-danger/70'
                                                            : isComplete
                                                                ? 'bg-white/85'
                                                                : isProcessing
                                                                    ? 'bg-white/40 animate-pulse'
                                                                    : 'bg-white/8'
                                                            }`}
                                                        title={`Scene ${i + 1}: ${sceneStatus || 'pending'}`}
                                                    />
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Footer microcopy — rotates based on stage */}
                                    <p className="text-[11px] text-white/40 italic text-center">
                                        {isAssembling
                                            ? 'Final stitch — about 10 seconds'
                                            : completedScenes === 0
                                                ? 'Warming up the renderer…'
                                                : `${completedScenes} scene${completedScenes === 1 ? '' : 's'} done — keep going`}
                                    </p>
                                </div>
                            );
                        })()}

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
                                    {storyboard.scenes.map((scene) => {
                                        const isExpanded = expandedSceneIds.has(scene.id);
                                        const previewText = scene.visualDescription || scene.narration || '';
                                        const hasContent = Boolean(scene.visualDescription || scene.narration);
                                        return (
                                            <div
                                                key={scene.id}
                                                className="rounded-xl bg-navy-900/40 border border-primary-500/5"
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => toggleSceneExpanded(scene.id)}
                                                    disabled={!hasContent}
                                                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-navy-900/60 transition-colors disabled:cursor-default rounded-xl"
                                                    aria-expanded={isExpanded}
                                                >
                                                    {/* Thumbnail poster — 16:9 mini frame. Falls back to a
                                                        gradient + scene number when no thumbnail exists yet
                                                        (scene still rendering, or rendered before thumbs were
                                                        wired up). */}
                                                    <div className="shrink-0 relative w-[72px] h-40px rounded-md overflow-hidden border border-white/8 bg-navy-900/60">
                                                        {scene.thumbnailUrl ? (
                                                            <img
                                                                src={scene.thumbnailUrl}
                                                                alt={`Scene ${scene.sceneNumber}`}
                                                                className="w-full h-full object-cover"
                                                                loading="lazy"
                                                            />
                                                        ) : (
                                                            <div className="w-full h-full bg-linear-to-br from-white/10 via-white/5 to-transparent flex items-center justify-center text-[11px] font-mono text-white/40">
                                                                #{scene.sceneNumber}
                                                            </div>
                                                        )}
                                                        {/* Status pill in the corner of the poster */}
                                                        <span
                                                            className={`absolute bottom-0.5 right-0.5 w-3 h-3 rounded-full ring-1 ring-black/60 ${scene.status === 'completed'
                                                                ? 'bg-success'
                                                                : scene.status === 'processing'
                                                                    ? 'bg-warning animate-pulse'
                                                                    : scene.status === 'failed'
                                                                        ? 'bg-danger'
                                                                        : 'bg-slate-500'
                                                                }`}
                                                            aria-label={scene.status}
                                                        />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-xs font-medium text-slate-300 line-clamp-1">
                                                            Scene {scene.sceneNumber}
                                                        </p>
                                                        {!isExpanded && (
                                                            <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">
                                                                {previewText || <span className="italic text-slate-700">(no description loaded)</span>}
                                                            </p>
                                                        )}
                                                    </div>
                                                    {hasContent && (
                                                        <ChevronDown
                                                            className={`shrink-0 w-4 h-4 text-slate-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                                        />
                                                    )}
                                                </button>

                                                {isExpanded && hasContent && (
                                                    <div className="px-4 pb-3 pt-1 space-y-2.5 border-t border-primary-500/5">
                                                        {scene.visualDescription && (
                                                            <div>
                                                                <p className="text-[10px] font-semibold text-primary-300 uppercase tracking-wider mb-1">
                                                                    Visual
                                                                </p>
                                                                <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-wrap">
                                                                    {scene.visualDescription}
                                                                </p>
                                                            </div>
                                                        )}
                                                        {scene.narration && (
                                                            <div>
                                                                <p className="text-[10px] font-semibold text-primary-300 uppercase tracking-wider mb-1">
                                                                    Narration
                                                                </p>
                                                                <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-wrap">
                                                                    {scene.narration}
                                                                </p>
                                                            </div>
                                                        )}
                                                        {scene.status === 'failed' && (
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleRetryScene(scene.id); }}
                                                                disabled={retryingSceneId !== null}
                                                                className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md bg-primary-500/10 hover:bg-primary-500/20 border border-primary-500/20 text-primary-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                                                title="Re-run the full pipeline for this scene"
                                                            >
                                                                {retryingSceneId === scene.id ? (
                                                                    <>
                                                                        <RefreshCcw className="w-3 h-3 animate-spin" />
                                                                        Retrying
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <RefreshCcw className="w-3 h-3" />
                                                                        Retry
                                                                    </>
                                                                )}
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
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
            </div>
        </div>
    );
}

// ==========================================
// SIDEBAR NAV ITEM
// ==========================================

function SidebarNavItem({
    icon,
    label,
    onClick,
    collapsed,
    active,
    trailing,
}: {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    collapsed: boolean;
    active?: boolean;
    trailing?: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            title={collapsed ? label : undefined}
            className={`w-full flex items-center rounded-lg transition-colors text-sm ${collapsed ? 'p-2 justify-center' : 'gap-3 px-3 py-2'} ${active
                ? 'bg-white/8 text-slate-100'
                : 'text-slate-400 hover:text-slate-100 hover:bg-white/5'
                }`}
        >
            <span className="shrink-0">{icon}</span>
            {!collapsed && (
                <>
                    <span className="flex-1 text-left truncate">{label}</span>
                    {trailing}
                </>
            )}
        </button>
    );
}
