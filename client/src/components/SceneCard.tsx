/**
 * SceneCard — editable card for a single scene in the review/iterate flow.
 *
 * Shows: scene number, editable narration, editable visual description,
 *        Monaco editor for the Manim Python code, and per-scene actions
 *        (Generate AI Code, Save, Regenerate). Used by DashboardPage in the
 *        draft state before the user kicks off the full render.
 */

import { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import {
    Sparkles,
    RefreshCcw,
    Save,
    Code as CodeIcon,
    CheckCircle2,
    AlertCircle,
} from 'lucide-react';
import { api, type Scene } from '../services/api';

interface SceneCardProps {
    scene: Scene;
    onSceneUpdated: (updated: Scene) => void;
}

export function SceneCard({ scene, onSceneUpdated }: SceneCardProps) {
    const [narration, setNarration] = useState(scene.narration);
    const [visualDescription, setVisualDescription] = useState(scene.visualDescription);
    const [code, setCode] = useState<string>(typeof scene.manimCode === 'string' ? scene.manimCode : '');
    const [generating, setGenerating] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string>();
    const [savedTick, setSavedTick] = useState(false);

    // Re-sync local state if the parent passes in a fresh scene (e.g. after refresh).
    useEffect(() => {
        setNarration(scene.narration);
        setVisualDescription(scene.visualDescription);
        if (typeof scene.manimCode === 'string') setCode(scene.manimCode);
    }, [scene.id, scene.manimCode, scene.narration, scene.visualDescription]);

    const hasCode = code.trim().length > 0 && code.includes('class GeneratedScene');

    const handleGenerateCode = async () => {
        setError(undefined);
        setGenerating(true);
        try {
            const updated = await api.generateSceneCode(scene.id);
            setCode(typeof updated.manimCode === 'string' ? updated.manimCode : '');
            onSceneUpdated(updated);
        } catch (err) {
            setError((err as Error).message || 'Code generation failed');
        } finally {
            setGenerating(false);
        }
    };

    const handleSave = async () => {
        setError(undefined);
        setSaving(true);
        try {
            const updated = await api.updateScene(scene.id, {
                narration,
                visualDescription,
                manimCode: code,
            });
            onSceneUpdated(updated);
            setSavedTick(true);
            setTimeout(() => setSavedTick(false), 1500);
        } catch (err) {
            setError((err as Error).message || 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    const isDirty =
        narration !== scene.narration ||
        visualDescription !== scene.visualDescription ||
        code !== (typeof scene.manimCode === 'string' ? scene.manimCode : '');

    return (
        <div className="glass-card rounded-2xl p-5 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                            scene.status === 'completed'
                                ? 'bg-success/20 text-success'
                                : scene.status === 'failed'
                                    ? 'bg-danger/20 text-danger'
                                    : 'bg-primary-500/15 text-primary-300'
                        }`}
                    >
                        {scene.status === 'completed' ? '✓' : scene.sceneNumber}
                    </div>
                    <h3 className="text-sm font-semibold text-slate-200">
                        Scene {scene.sceneNumber}
                    </h3>
                    {hasCode && (
                        <span className="text-[10px] text-success uppercase tracking-wider flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            Has code
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {savedTick && (
                        <span className="text-[10px] text-success flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            Saved
                        </span>
                    )}
                </div>
            </div>

            {/* Narration */}
            <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                    Narration
                </label>
                <textarea
                    className="w-full resize-none rounded-lg bg-navy-900/80 border border-primary-500/10 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500/20 transition-all"
                    rows={2}
                    value={narration}
                    onChange={(e) => setNarration(e.target.value)}
                />
            </div>

            {/* Visual Description */}
            <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                    Visual Description
                </label>
                <textarea
                    className="w-full resize-none rounded-lg bg-navy-900/80 border border-primary-500/10 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500/20 transition-all"
                    rows={2}
                    value={visualDescription}
                    onChange={(e) => setVisualDescription(e.target.value)}
                />
            </div>

            {/* Manim code */}
            <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                    <label className="text-[11px] font-medium text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                        <CodeIcon className="w-3 h-3" />
                        Manim Python Code
                    </label>
                    <button
                        onClick={handleGenerateCode}
                        disabled={generating}
                        className="text-[11px] flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary-500/10 border border-primary-500/20 text-primary-300 hover:bg-primary-500/15 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {generating ? (
                            <>
                                <RefreshCcw className="w-3 h-3 animate-spin" />
                                {hasCode ? 'Regenerating...' : 'Generating...'}
                            </>
                        ) : hasCode ? (
                            <>
                                <Sparkles className="w-3 h-3" />
                                Regenerate Code
                            </>
                        ) : (
                            <>
                                <Sparkles className="w-3 h-3" />
                                Generate AI Code
                            </>
                        )}
                    </button>
                </div>

                {hasCode || code.length > 0 ? (
                    <div className="rounded-lg overflow-hidden border border-primary-500/10">
                        <Editor
                            height="320px"
                            defaultLanguage="python"
                            language="python"
                            theme="vs-dark"
                            value={code}
                            onChange={(v) => setCode(v ?? '')}
                            options={{
                                fontSize: 12,
                                minimap: { enabled: false },
                                scrollBeyondLastLine: false,
                                automaticLayout: true,
                                lineNumbers: 'on',
                                wordWrap: 'on',
                            }}
                        />
                    </div>
                ) : (
                    <div className="rounded-lg border border-dashed border-primary-500/15 bg-navy-900/40 px-4 py-8 text-center text-xs text-slate-600">
                        Click "Generate AI Code" to populate this scene's Manim script.
                    </div>
                )}
            </div>

            {/* Error */}
            {error && (
                <div className="rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-xs text-danger flex items-start gap-2">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {/* Save */}
            <div className="flex justify-end">
                <button
                    onClick={handleSave}
                    disabled={!isDirty || saving}
                    className="text-xs flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-500/15 border border-primary-500/30 text-primary-200 hover:bg-primary-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    {saving ? (
                        <>
                            <RefreshCcw className="w-3.5 h-3.5 animate-spin" />
                            Saving...
                        </>
                    ) : (
                        <>
                            <Save className="w-3.5 h-3.5" />
                            Save Changes
                        </>
                    )}
                </button>
            </div>
        </div>
    );
}
