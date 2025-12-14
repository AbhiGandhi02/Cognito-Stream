import { useMemo, useState } from 'react';
import type { Scene } from '../services/api';
import { ProgressBar } from './ProgressBar';
import { VideoPlayer } from './VideoPlayer';
import { ChevronDownIcon, PlayIcon, CheckIcon } from '@heroicons/react/24/outline';

type SceneEditorProps = {
  scene: Scene;
  onSave: (sceneId: string, payload: { narration: string; manimOperations: string[] }) => Promise<void>;
  onProcess: (sceneId: string) => Promise<void>;
};

const parseOperations = (raw: string) => {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as string[];
    return [];
  } catch {
    return raw.split('\n').map((line) => line.trim()).filter(Boolean);
  }
};

const stringifyOperations = (raw: string) => {
  return parseOperations(raw).join('\n');
};

const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
};

const getStatusBadge = (status: string) => {
  switch (status) {
    case 'completed':
      return <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-1 text-xs font-semibold text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{status}</span>;
    case 'processing':
      return <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-2.5 py-1 text-xs font-semibold text-amber-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />{status}</span>;
    case 'failed':
      return <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/20 px-2.5 py-1 text-xs font-semibold text-red-300"><span className="h-1.5 w-1.5 rounded-full bg-red-400" />{status}</span>;
    default:
      return <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-700/60 px-2.5 py-1 text-xs font-semibold text-slate-200">{status}</span>;
  }
};

export const SceneEditor = ({ scene, onSave, onProcess }: SceneEditorProps) => {
  const initialOperations = useMemo(() => stringifyOperations(scene.manimCode), [scene.manimCode]);
  const [narration, setNarration] = useState(scene.narration);
  const [manimOperations, setManimOperations] = useState(initialOperations);
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string>();
  const [successMessage, setSuccessMessage] = useState<string>();
  const [showCode, setShowCode] = useState(true);

  const handleSave = async () => {
    setSaving(true);
    setError(undefined);
    setSuccessMessage(undefined);
    try {
      const operations = manimOperations.split('\n').map((line) => line.trim()).filter(Boolean);
      await onSave(scene.id, { narration, manimOperations: operations });
      setSuccessMessage('Scene saved');
      setTimeout(() => setSuccessMessage(undefined), 3000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleProcess = async () => {
    setProcessing(true);
    setError(undefined);
    setSuccessMessage(undefined);
    try {
      await onProcess(scene.id);
      setSuccessMessage('Processing complete');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProcessing(false);
    }
  };

  const getProgress = () => {
    if (scene.status === 'completed') return 100;
    if (scene.status === 'processing') return 50;
    return 0;
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 transition-all duration-200">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-500/20 text-xs font-bold text-purple-400">
              {scene.sceneNumber}
            </span>
            <h3 className="truncate font-semibold text-white">
              {scene.visualDescription?.slice(0, 50) || `Scene ${scene.sceneNumber}`}
            </h3>
          </div>

          <div className="mt-1.5 flex items-center gap-3 text-xs text-slate-500">
            <span>Est: {formatDuration(scene.estimatedDuration)}</span>
            {scene.actualDuration && (
              <>
                <span>•</span>
                <span className="text-emerald-400">Actual: {formatDuration(scene.actualDuration)}</span>
              </>
            )}
          </div>
        </div>
        {getStatusBadge(scene.status)}
      </div>

      {/* Progress Bar */}
      {(scene.status === 'processing' || processing) && (
        <div className="mt-4">
          <ProgressBar value={getProgress()} status="processing" showLabel label="Generating audio & video..." />
        </div>
      )}

      {/* Video Preview */}
      {scene.status === 'completed' && scene.videoUrl && (
        <div className="mt-4">
          <VideoPlayer src={scene.videoUrl} title={`Scene ${scene.sceneNumber}`} duration={scene.actualDuration} compact />
        </div>
      )}

      {/* Audio Preview */}
      {scene.audioUrl && !scene.videoUrl && (
        <div className="mt-4">
          <label className="mb-1.5 block text-xs font-medium text-slate-400">Audio Preview</label>
          <audio className="w-full rounded-lg" controls src={scene.audioUrl}>
            Your browser does not support the audio element.
          </audio>
        </div>
      )}

      {/* Narration */}
      <div className="mt-4">
        <label className="mb-1.5 block text-xs font-medium text-slate-400">Narration</label>
        <textarea
          className="w-full resize-none rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-sm text-white placeholder:text-slate-500 transition-all duration-200 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
          rows={3}
          value={narration}
          onChange={(e) => setNarration(e.target.value)}
          placeholder="Enter the narration for this scene..."
        />
      </div>

      {/* Visual Description */}
      {scene.visualDescription && (
        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/30 p-3">
          <p className="mb-1 text-xs font-medium text-slate-500">Visual Description</p>
          <p className="text-sm text-slate-300">{scene.visualDescription}</p>
        </div>
      )}

      {/* Collapsible Manim Code */}
      <div className="mt-4">
        <button
          onClick={() => setShowCode(!showCode)}
          className="flex w-full items-center justify-between rounded-lg bg-slate-800/50 px-3 py-2 text-left text-sm font-medium text-slate-300 hover:bg-slate-800"
        >
          <span>Manim Operations</span>
          <ChevronDownIcon className={`h-4 w-4 transition-transform ${showCode ? 'rotate-180' : ''}`} />
        </button>

        {showCode && (
          <textarea
            className="mt-2 w-full resize-none rounded-xl border border-slate-800 bg-black px-4 py-3 font-mono text-sm text-emerald-200 placeholder:text-slate-500 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
            rows={5}
            value={manimOperations}
            onChange={(e) => setManimOperations(e.target.value)}
            placeholder={"Text('Hello world').scale(0.8)\nCircle().set_fill(BLUE, opacity=0.4)"}
          />
        )}
      </div>

      {/* Messages */}
      {error && (
        <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}
      {successMessage && (
        <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
          {successMessage}
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex gap-2">
        <button
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Saving...
            </>
          ) : (
            <>
              <CheckIcon className="h-4 w-4" />
              Save
            </>
          )}
        </button>
        <button
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-600 bg-transparent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={handleProcess}
          disabled={processing || scene.status === 'processing'}
        >
          {processing || scene.status === 'processing' ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
              Processing...
            </>
          ) : (
            <>
              <PlayIcon className="h-4 w-4" />
              Process
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default SceneEditor;
