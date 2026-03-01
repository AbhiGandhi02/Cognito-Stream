/**
 * DashboardPage — full workspace with prompt input, scene sidebar, video player, and scene editor.
 * Ports the existing App.tsx workspace logic into a dedicated page.
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Scene, type Storyboard } from '../services/api';
import { Sidebar } from '../components/Sidebar';
import { SceneEditor } from '../components/SceneEditor';
import { VideoPlayer } from '../components/VideoPlayer';
import { ProgressBar } from '../components/ProgressBar';
import {
    Sparkles,
    Download,
    RefreshCcw,
    ArrowLeft,
    Zap,
    FlaskConical,
} from 'lucide-react';

export function DashboardPage() {
    // ==========================================
    // STATE
    // ==========================================
    const [prompt, setPrompt] = useState('');
    const [storyboards, setStoryboards] = useState<Storyboard[]>([]);
    const [storyboard, setStoryboard] = useState<Storyboard | null>(null);
    const [selectedScene, setSelectedScene] = useState<Scene | null>(null);
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

    // Auto-poll while processing
    useEffect(() => {
        if (!storyboard || storyboard.status !== 'processing') return;
        const interval = setInterval(() => {
            refreshStoryboard(storyboard.id);
        }, 3000);
        return () => clearInterval(interval);
    }, [storyboard?.id, storyboard?.status, refreshStoryboard]);

    // ==========================================
    // HANDLERS
    // ==========================================

    const handleGenerate = async () => {
        if (!prompt.trim()) return;
        setLoading(true);
        setError(undefined);
        try {
            const sb = await api.createStoryboard({ prompt, autoGenerate: true });
            setStoryboard(sb);
            setSelectedScene(sb.scenes?.[0] || null);
            setPrompt('');
            setStoryboards((prev) => [sb, ...prev]);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    };

    const handleTestGenerate = async () => {
        setLoading(true);
        setError(undefined);
        try {
            const sb = await api.createTestStoryboard();
            setStoryboard(sb);
            setSelectedScene(sb.scenes?.[0] || null);
            setStoryboards((prev) => [sb, ...prev]);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    };

    const handleSceneSave = async (
        sceneId: string,
        payload: { narration: string; manimOperations: string[] }
    ) => {
        const updated = await api.updateScene(sceneId, {
            narration: payload.narration,
            manimCode: payload.manimOperations as unknown as string,
        });
        setStoryboard((prev) =>
            prev
                ? { ...prev, scenes: prev.scenes.map((s) => (s.id === updated.id ? updated : s)) }
                : prev
        );
        if (selectedScene?.id === updated.id) setSelectedScene(updated);
    };

    const handleSceneProcess = async (sceneId: string) => {
        setStoryboard((prev) =>
            prev
                ? {
                    ...prev,
                    scenes: prev.scenes.map((s) =>
                        s.id === sceneId ? { ...s, status: 'processing' as const } : s
                    ),
                }
                : prev
        );
        try {
            const updated = await api.processScene(sceneId);
            setStoryboard((prev) =>
                prev
                    ? { ...prev, scenes: prev.scenes.map((s) => (s.id === updated.id ? updated : s)) }
                    : prev
            );
            if (selectedScene?.id === updated.id) setSelectedScene(updated);
        } catch (err) {
            if (storyboard) refreshStoryboard(storyboard.id);
            throw err;
        }
    };

    const handleSelectStoryboard = (sb: Storyboard) => {
        setStoryboard(sb);
        setSelectedScene(sb.scenes?.[0] || null);
        setError(undefined);
    };

    const handleNewStoryboard = () => {
        setStoryboard(null);
        setSelectedScene(null);
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
            ) : (
                /* ====================== WORKSPACE ====================== */
                <main className="flex-1 flex gap-4 p-4 overflow-hidden">
                    {/* Left sidebar */}
                    <Sidebar
                        storyboards={storyboards}
                        selectedStoryboard={storyboard}
                        selectedScene={selectedScene}
                        onSelectStoryboard={handleSelectStoryboard}
                        onSelectScene={setSelectedScene}
                        onNewStoryboard={handleNewStoryboard}
                    />

                    {/* Main content area */}
                    <div className="flex-1 overflow-y-auto space-y-4 min-w-0">
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

                            {(storyboard.status === 'processing' || (progress > 0 && progress < 100)) && (
                                <div className="mt-4">
                                    <ProgressBar
                                        progress={progress}
                                        label={`${completedScenes} / ${totalScenes} scenes complete`}
                                    />
                                </div>
                            )}
                        </div>

                        {/* Error */}
                        {error && (
                            <div className="rounded-xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
                                {error}
                            </div>
                        )}

                        {/* Final video */}
                        {storyboard.finalVideoUrl && (
                            <div className="glass-card rounded-2xl p-5 space-y-4">
                                <h3 className="text-sm font-semibold text-slate-400">
                                    🎬 Final Video
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

                        {/* Assembling message */}
                        {!storyboard.finalVideoUrl && allScenesCompleted && storyboard.status === 'processing' && (
                            <div className="glass-card rounded-2xl p-5 flex items-center gap-3">
                                <RefreshCcw className="w-5 h-5 animate-spin text-primary-400" />
                                <p className="text-sm text-slate-500">
                                    Assembling final video from {totalScenes} scenes...
                                </p>
                            </div>
                        )}

                        {/* Scene editor */}
                        {selectedScene && (
                            <SceneEditor
                                scene={selectedScene}
                                onProcess={handleSceneProcess}
                                onSave={handleSceneSave}
                                isLoading={loading}
                            />
                        )}

                        {/* Scene video preview */}
                        {selectedScene?.videoUrl && (
                            <div className="glass-card rounded-2xl p-5 space-y-3">
                                <h3 className="text-sm font-semibold text-slate-400">
                                    Scene {selectedScene.sceneNumber} Preview
                                </h3>
                                <VideoPlayer
                                    videoUrl={selectedScene.videoUrl}
                                    title={`Scene ${selectedScene.sceneNumber}`}
                                    className="aspect-video"
                                />
                            </div>
                        )}

                        {/* Back button */}
                        <div className="pt-2 pb-8">
                            <button
                                onClick={handleNewStoryboard}
                                className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
                            >
                                ← Create New Storyboard
                            </button>
                        </div>
                    </div>
                </main>
            )}
        </div>
    );
}
