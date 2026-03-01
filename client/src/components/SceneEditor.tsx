/**
 * SceneEditor — detail view for a single scene.
 * Shows narration text, visual description, Manim code preview, and action buttons.
 */

import { useState } from 'react';
import { type Scene } from '../services/api';
import {
  Play,
  PenSquare,
  RefreshCcw,
  Eye,
  Code,
} from 'lucide-react';

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

  const formattedCode = typeof scene.manimCode === 'string'
    ? scene.manimCode
    : JSON.stringify(scene.manimCode, null, 2);

  return (
    <div className="glass-card rounded-2xl p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-mono text-slate-600 uppercase tracking-wider">
            Scene {String(scene.sceneNumber).padStart(2, '0')} — Detail
          </p>
          <h3 className="text-lg font-semibold text-slate-100 mt-0.5">
            {scene.visualDescription?.substring(0, 60) || 'Scene Details'}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCode(!showCode)}
            className={`p-2 rounded-lg transition-colors ${showCode
              ? 'bg-primary-500/15 text-primary-300'
              : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
              }`}
            title="Toggle code view"
          >
            <Code className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Narration */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            Narration
          </label>
          {!isEditing && (
            <button
              onClick={() => {
                setEditedNarration(scene.narration);
                setIsEditing(true);
              }}
              className="text-xs text-primary-400/70 hover:text-primary-300 flex items-center gap-1 transition-colors"
            >
              <PenSquare className="w-3 h-3" />
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
              className="w-full bg-navy-900/80 border border-primary-500/10 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500/20 resize-none"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setIsEditing(false)}
                className="text-xs px-3 py-1.5 rounded-lg text-slate-500 hover:text-slate-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                className="text-xs px-3 py-1.5 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors"
              >
                Save Changes
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-400 leading-relaxed bg-navy-900/40 rounded-xl px-4 py-3 border border-white/5">
            {scene.narration || 'No narration text.'}
          </p>
        )}
      </div>

      {/* Visual Description */}
      <div>
        <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2 block">
          Visual Description
        </label>
        <p className="text-sm text-slate-500 leading-relaxed bg-navy-900/40 rounded-xl px-4 py-3 border border-white/5">
          {scene.visualDescription || 'No visual description.'}
        </p>
      </div>

      {/* Manim Code (toggleable) */}
      {showCode && (
        <div>
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2 block">
            Manim Code
          </label>
          <pre className="text-xs text-success/80 font-mono bg-navy-950 rounded-xl px-4 py-3 border border-white/5 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
            {formattedCode || 'No code generated yet.'}
          </pre>
        </div>
      )}

      {/* Meta info */}
      <div className="flex items-center gap-4 text-[10px] text-slate-600 pt-2 border-t border-white/5">
        <span className="flex items-center gap-1">
          <Eye className="w-3 h-3" />
          {scene.estimatedDuration}s estimated
        </span>
        {scene.actualDuration && (
          <span className="text-success/60">
            {scene.actualDuration}s actual
          </span>
        )}
        {scene.audioUrl && (
          <span className="text-info/60">Audio ready</span>
        )}
        {scene.videoUrl && (
          <span className="text-success/60">Video ready</span>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={() => onProcess(scene.id)}
          disabled={isLoading || scene.status === 'processing'}
          className="btn-primary flex-1 flex items-center justify-center gap-2 py-2.5 text-sm"
        >
          {scene.status === 'processing' ? (
            <>
              <RefreshCcw className="w-4 h-4 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              {scene.status === 'completed' ? 'Re-process' : 'Generate Scene'}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
