import { useState, useEffect } from 'react';
import { api, type Scene, type Storyboard } from './services/api';
import { SceneEditor } from './components/SceneEditor';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { VideoPlayer } from './components/VideoPlayer';
import { ProgressBar } from './components/ProgressBar';
import { ArrowPathIcon, VideoCameraIcon, ArrowDownTrayIcon, SparklesIcon } from '@heroicons/react/24/outline';
import './index.css';

const getStatusBadge = (status: string) => {
  switch (status) {
    case 'completed':
      return <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-1 text-xs font-semibold text-emerald-300">completed</span>;
    case 'processing':
      return <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-2.5 py-1 text-xs font-semibold text-amber-300">processing</span>;
    case 'failed':
      return <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/20 px-2.5 py-1 text-xs font-semibold text-red-300">failed</span>;
    default:
      return <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/20 px-2.5 py-1 text-xs font-semibold text-blue-300">draft</span>;
  }
};

function App() {
  const [prompt, setPrompt] = useState('');
  const [storyboard, setStoryboard] = useState<Storyboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [rendering, setRendering] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem('sidebarOpen');
    if (saved !== null) setSidebarOpen(JSON.parse(saved));
  }, []);

  useEffect(() => {
    localStorage.setItem('sidebarOpen', JSON.stringify(sidebarOpen));
  }, [sidebarOpen]);

  const refreshStoryboard = async (id: string) => {
    try {
      const fresh = await api.getStoryboard(id);
      setStoryboard(fresh);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(undefined);
    try {
      const sb = await api.createStoryboard({ prompt });
      setStoryboard(sb);
      setPrompt('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSceneSave = async (sceneId: string, payload: { narration: string; manimOperations: string[] }) => {
    const updatedScene = await api.updateScene(sceneId, {
      narration: payload.narration,
      manimCode: payload.manimOperations as unknown as string,
    });
    setStoryboard((prev) =>
      prev ? { ...prev, scenes: prev.scenes.map((s) => (s.id === updatedScene.id ? updatedScene : s)) } : prev
    );
  };

  const handleSceneProcess = async (sceneId: string) => {
    setStoryboard((prev) =>
      prev ? { ...prev, scenes: prev.scenes.map((s) => (s.id === sceneId ? { ...s, status: 'processing' as const } : s)) } : prev
    );
    try {
      const updatedScene = await api.processScene(sceneId);
      setStoryboard((prev) =>
        prev ? { ...prev, scenes: prev.scenes.map((s) => (s.id === updatedScene.id ? updatedScene : s)) } : prev
      );
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
    setPrompt('');
    setError(undefined);
    if (window.innerWidth < 1024) setSidebarOpen(false);
  };

  const handleNewStoryboard = () => {
    setStoryboard(null);
    setPrompt('');
    setError(undefined);
    if (window.innerWidth < 1024) setSidebarOpen(false);
  };

  const handleDownload = async () => {
    if (!storyboard?.finalVideoUrl) return;
    try {
      await api.downloadVideo(storyboard.finalVideoUrl, `${storyboard.title.replace(/[^a-z0-9]/gi, '_')}.mp4`);
    } catch {
      setError('Download failed. Try right-clicking the video and saving it.');
    }
  };

  const completedScenes = storyboard?.scenes.filter((s) => s.status === 'completed').length || 0;
  const totalScenes = storyboard?.scenes.length || 0;
  const progress = totalScenes > 0 ? (completedScenes / totalScenes) * 100 : 0;
  const allScenesCompleted = completedScenes === totalScenes && totalScenes > 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-950 to-black text-white">
      <Sidebar
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        currentStoryboardId={storyboard?.id}
        onSelectStoryboard={handleSelectStoryboard}
        onNewStoryboard={handleNewStoryboard}
      />

      <main className={`min-h-screen px-4 py-6 transition-[margin] duration-300 sm:px-6 lg:px-8 lg:py-10 ${sidebarOpen ? 'lg:ml-72' : ''}`}>
        <div className="mx-auto max-w-5xl">
          {!storyboard ? (
            <>
              <Header showPromptForm />

              <div className="mt-8">
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
                  <label className="mb-2 block text-sm font-semibold text-slate-200">
                    What would you like to learn about?
                  </label>
                  <textarea
                    className="w-full resize-none rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-white placeholder:text-slate-500 transition-all duration-200 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                    rows={4}
                    placeholder="e.g., Explain the Pythagorean theorem for middle schoolers with visual examples..."
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && e.metaKey) handleGenerate();
                    }}
                  />

                  {error && (
                    <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                      {error}
                    </div>
                  )}

                  <button
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-purple-600 py-3 text-base font-semibold text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={handleGenerate}
                    disabled={loading || !prompt.trim()}
                  >
                    {loading ? (
                      <>
                        <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        Generating Storyboard...
                      </>
                    ) : (
                      <>
                        <SparklesIcon className="h-5 w-5" />
                        Generate Storyboard
                      </>
                    )}
                  </button>

                  <p className="mt-3 text-center text-xs text-slate-500">Press ⌘+Enter to generate</p>
                </div>
              </div>
            </>
          ) : (
            <div>
              {/* Storyboard Header */}
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">{getStatusBadge(storyboard.status)}</div>
                  <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">{storyboard.title}</h1>
                  <p className="mt-2 text-slate-400">{storyboard.description}</p>
                </div>
                <button
                  className="shrink-0 rounded-lg bg-transparent p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
                  onClick={() => refreshStoryboard(storyboard.id)}
                  title="Refresh"
                >
                  <ArrowPathIcon className="h-5 w-5" />
                </button>
              </div>

              {/* Progress */}
              <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-300">Scene Progress</span>
                  <span className="text-sm text-slate-400">{completedScenes} / {totalScenes} completed</span>
                </div>
                <ProgressBar
                  value={progress}
                  status={storyboard.status === 'completed' ? 'completed' : progress === 100 ? 'idle' : 'processing'}
                  showPercentage={false}
                  size="md"
                />
              </div>

              {/* Final Video */}
              {(allScenesCompleted || storyboard.finalVideoUrl) && (
                <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                  <h2 className="mb-4 text-lg font-semibold text-white">
                    {storyboard.finalVideoUrl ? '🎬 Final Video' : '🎬 Ready to Render'}
                  </h2>

                  {storyboard.finalVideoUrl ? (
                    <div className="space-y-4">
                      <VideoPlayer src={storyboard.finalVideoUrl} title={storyboard.title} duration={storyboard.totalDuration} />
                      <button
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 font-semibold text-white transition-colors hover:bg-emerald-700"
                        onClick={handleDownload}
                      >
                        <ArrowDownTrayIcon className="h-5 w-5" />
                        Download Video
                      </button>
                    </div>
                  ) : (
                    <div>
                      <p className="mb-4 text-sm text-slate-400">All scenes are ready! Click below to assemble the final video.</p>
                      <button
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 py-2.5 font-semibold text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={handleStoryboardRender}
                        disabled={rendering}
                      >
                        {rendering ? (
                          <>
                            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                            Assembling Video...
                          </>
                        ) : (
                          <>
                            <VideoCameraIcon className="h-5 w-5" />
                            Assemble Final Video
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="mt-6 rounded-xl border border-red-500/20 bg-red-500/10 p-4">
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}

              {/* Scenes */}
              <div className="mt-8">
                <h2 className="mb-4 text-lg font-semibold text-white">Scenes ({totalScenes})</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {storyboard.scenes.map((scene: Scene) => (
                    <SceneEditor key={scene.id} scene={scene} onSave={handleSceneSave} onProcess={handleSceneProcess} />
                  ))}
                </div>
              </div>

              {/* Back Button */}
              <div className="mt-8 border-t border-slate-800 pt-6">
                <button
                  className="rounded-lg bg-transparent px-3 py-2 text-sm text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
                  onClick={handleNewStoryboard}
                >
                  ← Create New Storyboard
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
