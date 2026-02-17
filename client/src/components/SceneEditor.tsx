/**
 * SceneEditor — detail view for a single scene.
 * Shows narration text, visual description, Manim code preview, and action buttons.
 */

import { useState } from 'react';
import { type Scene } from '../services/api';
import {
  PlayIcon,
  PencilSquareIcon,
  ArrowPathIcon,
  EyeIcon,
  CodeBracketIcon,
} from '@heroicons/react/24/outline';

interface SceneEditorProps {
  scene: Scene;
  onProcess: (sceneId: string) => void;
  onSave: (sceneId: string, payload: { narration: string; manimOperations: string[] }) => void;
  isLoading: boolean;
}

export function SceneEditor({ scene, onProcess, onSave, isLoading }: SceneEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedNarration, setEditedNarration] = useState(scene.narration);
  const [showCode, setShowCode] = useState(false);

  const handleSaveEdit = () => {
    const manimOps = typeof scene.manimCode === 'string'
      ? (() => { try { return JSON.parse(scene.manimCode); } catch { return []; } })()
      : scene.manimCode;

    onSave(scene.id, {
      narration: editedNarration,
      manimOperations: Array.isArray(manimOps) ? manimOps : [],
    });
    setIsEditing(false);
  };

  // Format Manim code for display
  const formattedCode = typeof scene.manimCode === 'string'
    ? scene.manimCode
    : JSON.stringify(scene.manimCode, null, 2);

  return (
    <div className="glass-light rounded-2xl p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-mono text-surface-200/40 uppercase tracking-wider">
            Scene {String(scene.sceneNumber).padStart(2, '0')} — Detail
          </p>
          <h3 className="text-lg font-semibold text-surface-100 mt-0.5">
            {scene.visualDescription?.substring(0, 60) || 'Scene Details'}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCode(!showCode)}
            className={`p-2 rounded-lg transition-colors ${showCode
                ? 'bg-brand-500/20 text-brand-300'
                : 'text-surface-200/40 hover:text-surface-200/70 hover:bg-white/5'
              }`}
            title="Toggle code view"
          >
            <CodeBracketIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Narration */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-surface-200/50 uppercase tracking-wider">
            Narration
          </label>
          {!isEditing && (
            <button
              onClick={() => {
                setEditedNarration(scene.narration);
                setIsEditing(true);
              }}
              className="text-xs text-brand-300/70 hover:text-brand-300 flex items-center gap-1 transition-colors"
            >
              <PencilSquareIcon className="w-3 h-3" />
              Edit
            </button>
          )}
        </div>

        {isEditing ? (
          <div className="space-y-2">
            <textarea
              value={editedNarration}
              onChange={(e) => setEditedNarration(e.target.value)}
              rows={4}
              className="w-full bg-surface-900/80 border border-white/10 rounded-xl px-4 py-3 text-sm text-surface-100 placeholder-surface-200/30 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500/40 resize-none"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setIsEditing(false)}
                className="text-xs px-3 py-1.5 rounded-lg text-surface-200/50 hover:text-surface-200/80 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                className="text-xs px-3 py-1.5 rounded-lg bg-brand-500 text-white hover:bg-brand-600 transition-colors"
              >
                Save Changes
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-surface-200/70 leading-relaxed bg-surface-900/40 rounded-xl px-4 py-3 border border-white/5">
            {scene.narration || 'No narration text.'}
          </p>
        )}
      </div>

      {/* Visual Description */}
      <div>
        <label className="text-xs font-medium text-surface-200/50 uppercase tracking-wider mb-2 block">
          Visual Description
        </label>
        <p className="text-sm text-surface-200/60 leading-relaxed bg-surface-900/40 rounded-xl px-4 py-3 border border-white/5">
          {scene.visualDescription || 'No visual description.'}
        </p>
      </div>

      {/* Manim Code (toggleable) */}
      {showCode && (
        <div>
          <label className="text-xs font-medium text-surface-200/50 uppercase tracking-wider mb-2 block">
            Manim Code
          </label>
          <pre className="text-xs text-accent-green/80 font-mono bg-surface-950 rounded-xl px-4 py-3 border border-white/5 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
            {formattedCode || 'No code generated yet.'}
          </pre>
        </div>
      )}

      {/* Meta info */}
      <div className="flex items-center gap-4 text-[10px] text-surface-200/30 pt-2 border-t border-white/5">
        <span className="flex items-center gap-1">
          <EyeIcon className="w-3 h-3" />
          {scene.estimatedDuration}s estimated
        </span>
        {scene.actualDuration && (
          <span className="text-accent-green/60">
            {scene.actualDuration}s actual
          </span>
        )}
        {scene.audioUrl && (
          <span className="text-accent-blue/60">Audio ready</span>
        )}
        {scene.videoUrl && (
          <span className="text-accent-green/60">Video ready</span>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={() => onProcess(scene.id)}
          disabled={isLoading || scene.status === 'processing'}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-brand-500 to-brand-600 text-white text-sm font-medium hover:from-brand-600 hover:to-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-brand-500/20"
        >
          {scene.status === 'processing' ? (
            <>
              <ArrowPathIcon className="w-4 h-4 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <PlayIcon className="w-4 h-4" />
              {scene.status === 'completed' ? 'Re-process' : 'Generate Scene'}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
