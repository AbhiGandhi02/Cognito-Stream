/**
 * App — main application shell for Cognito Stream.
 *
 * Two-state layout:
 *   1. Landing page (no storyboard selected) — prompt input with hero section
 *   2. Workspace (storyboard selected) — sidebar + editor + player
 */

import { useState, useEffect, useCallback } from 'react';
import { api, type Scene, type Storyboard } from './services/api';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { SceneEditor } from './components/SceneEditor';
import { VideoPlayer } from './components/VideoPlayer';
import { ProgressBar } from './components/ProgressBar';
import {
  SparklesIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  VideoCameraIcon,
} from '@heroicons/react/24/outline';
import './index.css';

function App() {
  // ==========================================
  // STATE
  // ==========================================
  const [prompt, setPrompt] = useState('');
  const [storyboards, setStoryboards] = useState<Storyboard[]>([]);
  const [storyboard, setStoryboard] = useState<Storyboard | null>(null);
  const [selectedScene, setSelectedScene] = useState<Scene | null>(null);
  const [loading, setLoading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string>();
  const [isConnected, setIsConnected] = useState(false);

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
      // Update in list too
      setStoryboards((prev) =>
        prev.map((sb) => (sb.id === id ? fresh : sb))
      );
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  // Initial load
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
      // Add to list
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

  const handleStoryboardRender = async () => {
    if (!storyboard) return;
    setRendering(true);
    setError(undefined);
    try {
      const updated = await api.renderStoryboard(storyboard.id);
      setStoryboard(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRendering(false);
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
    <div className="min-h-screen bg-surface-950 text-surface-100 flex flex-col">
      <Header isConnected={isConnected} />

      {!storyboard ? (
        /* ====================== LANDING PAGE ====================== */
        <main className="flex-1 flex items-center justify-center px-4 py-16">
          <div className="w-full max-w-2xl space-y-10">
            {/* Hero */}
            <div className="text-center space-y-3">
              <h2 className="text-4xl font-bold tracking-tight">
                <span className="gradient-text">Transform Ideas</span>{' '}
                <span className="text-surface-200/80">into Animated Videos</span>
              </h2>
              <p className="text-surface-200/50 text-lg max-w-lg mx-auto">
                Describe any concept and watch it come alive as a narrated 2D animation —
                powered by AI.
              </p>
            </div>

            {/* Prompt card */}
            <div className="glass rounded-2xl p-6 space-y-4">
              <label className="text-sm font-medium text-surface-200/60">
                What would you like to learn about?
              </label>
              <textarea
                className="w-full resize-none rounded-xl bg-surface-900/80 border border-white/10 px-4 py-3 text-surface-100 placeholder-surface-200/25 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500/30 transition-all"
                rows={4}
                placeholder="e.g., Explain the Pythagorean theorem for middle schoolers with visual examples..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.metaKey) handleGenerate();
                }}
              />

              {error && (
                <div className="rounded-xl border border-accent-rose/20 bg-accent-rose/10 px-4 py-2.5 text-sm text-accent-rose">
                  {error}
                </div>
              )}

              <button
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-brand-600 py-3.5 text-base font-semibold text-white hover:from-brand-600 hover:to-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-brand-500/20"
                onClick={handleGenerate}
                disabled={loading || !prompt.trim()}
              >
                {loading ? (
                  <>
                    <ArrowPathIcon className="w-5 h-5 animate-spin" />
                    Generating Storyboard...
                  </>
                ) : (
                  <>
                    <SparklesIcon className="w-5 h-5" />
                    Generate Video
                  </>
                )}
              </button>

              <button
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-2.5 text-sm font-medium text-surface-200/60 hover:bg-white/10 hover:text-surface-200/80 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                onClick={handleTestGenerate}
                disabled={loading}
              >
                🧪 Test Pipeline (No AI)
              </button>

              <p className="text-center text-[11px] text-surface-200/25">
                Press ⌘+Enter to generate
              </p>
            </div>

            {/* Recent projects */}
            {storyboards.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-surface-200/40 uppercase tracking-wider">
                  Recent Projects
                </h3>
                <div className="grid gap-2">
                  {storyboards.slice(0, 5).map((sb) => (
                    <button
                      key={sb.id}
                      onClick={() => handleSelectStoryboard(sb)}
                      className="glass-light rounded-xl p-4 text-left hover:bg-white/5 transition-all group"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-surface-200/80 group-hover:text-surface-100 transition-colors truncate">
                          {sb.title || 'Untitled'}
                        </span>
                        <span className="text-[10px] text-surface-200/30">
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
            <div className="glass-light rounded-2xl p-5">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-bold text-surface-100 truncate">
                    {storyboard.title}
                  </h2>
                  <p className="text-sm text-surface-200/50 mt-1 line-clamp-2">
                    {storyboard.description}
                  </p>
                </div>
                <button
                  onClick={() => refreshStoryboard(storyboard.id)}
                  className="p-2 rounded-lg text-surface-200/40 hover:text-surface-200/80 hover:bg-white/5 transition-colors shrink-0"
                  title="Refresh"
                >
                  <ArrowPathIcon className="w-4 h-4" />
                </button>
              </div>

              {/* Progress bar (show during processing or if not 100%) */}
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
              <div className="rounded-xl border border-accent-rose/20 bg-accent-rose/10 px-4 py-3 text-sm text-accent-rose">
                {error}
              </div>
            )}

            {/* Video section — show when ready */}
            {(allScenesCompleted || storyboard.finalVideoUrl) && (
              <div className="glass-light rounded-2xl p-5 space-y-4">
                <h3 className="text-sm font-semibold text-surface-200/70">
                  {storyboard.finalVideoUrl ? '🎬 Final Video' : '🎬 Ready to Assemble'}
                </h3>

                {storyboard.finalVideoUrl ? (
                  <div className="space-y-3">
                    <VideoPlayer
                      videoUrl={storyboard.finalVideoUrl}
                      title={storyboard.title}
                      className="aspect-video"
                    />
                    <button
                      onClick={handleDownload}
                      className="w-full flex items-center justify-center gap-2 rounded-xl bg-accent-green/15 border border-accent-green/20 py-2.5 text-sm font-medium text-accent-green hover:bg-accent-green/20 transition-colors"
                    >
                      <ArrowDownTrayIcon className="w-4 h-4" />
                      Download Video
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-surface-200/40">
                      All scenes are ready. Click below to assemble the final video.
                    </p>
                    <button
                      onClick={handleStoryboardRender}
                      disabled={rendering}
                      className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-brand-600 py-2.5 text-sm font-medium text-white hover:from-brand-600 hover:to-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-brand-500/20"
                    >
                      {rendering ? (
                        <>
                          <ArrowPathIcon className="w-4 h-4 animate-spin" />
                          Assembling...
                        </>
                      ) : (
                        <>
                          <VideoCameraIcon className="w-4 h-4" />
                          Assemble Final Video
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Scene detail editor — show when a scene is selected */}
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
              <div className="glass-light rounded-2xl p-5 space-y-3">
                <h3 className="text-sm font-semibold text-surface-200/70">
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
                className="text-xs text-surface-200/30 hover:text-surface-200/60 transition-colors"
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

export default App;
