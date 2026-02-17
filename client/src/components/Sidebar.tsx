/**
 * Sidebar — vertical scene timeline with status badges.
 * Shows all storyboards in a list, plus scene cards for the selected storyboard.
 */

import { type Scene, type Storyboard } from '../services/api';

interface SidebarProps {
    storyboards: Storyboard[];
    selectedStoryboard: Storyboard | null;
    selectedScene: Scene | null;
    onSelectStoryboard: (sb: Storyboard) => void;
    onSelectScene: (scene: Scene) => void;
    onNewStoryboard: () => void;
}

function getStatusColor(status: string) {
    switch (status) {
        case 'completed':
            return 'bg-accent-green/20 text-accent-green border-accent-green/30';
        case 'processing':
            return 'bg-brand-400/20 text-brand-300 border-brand-400/30 animate-pulse-glow';
        case 'failed':
            return 'bg-accent-rose/20 text-accent-rose border-accent-rose/30';
        default:
            return 'bg-surface-700/50 text-surface-200/50 border-surface-700/30';
    }
}

function getStatusDot(status: string) {
    switch (status) {
        case 'completed':
            return 'bg-accent-green';
        case 'processing':
            return 'bg-brand-400 animate-pulse';
        case 'failed':
            return 'bg-accent-rose';
        default:
            return 'bg-surface-200/30';
    }
}

export function Sidebar({
    storyboards,
    selectedStoryboard,
    selectedScene,
    onSelectStoryboard,
    onSelectScene,
    onNewStoryboard,
}: SidebarProps) {
    return (
        <aside className="w-72 shrink-0 glass-light rounded-2xl flex flex-col overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-white/5">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold text-surface-200/80 uppercase tracking-wider">
                        Projects
                    </h2>
                    <button
                        onClick={onNewStoryboard}
                        className="text-xs px-3 py-1.5 rounded-lg bg-brand-500/20 text-brand-300 hover:bg-brand-500/30 transition-colors border border-brand-500/20"
                    >
                        + New
                    </button>
                </div>

                {/* Storyboard list */}
                <div className="space-y-1 max-h-32 overflow-y-auto">
                    {storyboards.length === 0 ? (
                        <p className="text-xs text-surface-200/30 italic py-2">
                            No projects yet
                        </p>
                    ) : (
                        storyboards.map((sb) => (
                            <button
                                key={sb.id}
                                onClick={() => onSelectStoryboard(sb)}
                                className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all ${selectedStoryboard?.id === sb.id
                                        ? 'bg-brand-500/20 text-brand-200 border border-brand-500/30'
                                        : 'text-surface-200/60 hover:bg-white/5 border border-transparent'
                                    }`}
                            >
                                <div className="flex items-center gap-2">
                                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${getStatusDot(sb.status)}`} />
                                    <span className="truncate font-medium">{sb.title || 'Untitled'}</span>
                                </div>
                            </button>
                        ))
                    )}
                </div>
            </div>

            {/* Scene timeline */}
            {selectedStoryboard && (
                <div className="flex-1 overflow-y-auto p-4">
                    <h3 className="text-xs font-semibold text-surface-200/60 uppercase tracking-wider mb-3">
                        Scenes ({selectedStoryboard.scenes?.length || 0})
                    </h3>

                    <div className="space-y-2">
                        {selectedStoryboard.scenes?.map((scene, index) => (
                            <button
                                key={scene.id}
                                onClick={() => onSelectScene(scene)}
                                className={`w-full text-left p-3 rounded-xl transition-all group ${selectedScene?.id === scene.id
                                        ? 'bg-brand-500/15 border border-brand-500/30 shadow-lg shadow-brand-500/5'
                                        : 'hover:bg-white/5 border border-transparent'
                                    }`}
                            >
                                {/* Scene number + status */}
                                <div className="flex items-center justify-between mb-1.5">
                                    <span className="text-[10px] font-mono text-surface-200/40 uppercase">
                                        Scene {String(index + 1).padStart(2, '0')}
                                    </span>
                                    <span
                                        className={`text-[9px] px-1.5 py-0.5 rounded-full border ${getStatusColor(
                                            scene.status
                                        )}`}
                                    >
                                        {scene.status}
                                    </span>
                                </div>

                                {/* Narration preview */}
                                <p className="text-xs text-surface-200/70 line-clamp-2 leading-relaxed">
                                    {scene.narration?.substring(0, 80)}
                                    {(scene.narration?.length || 0) > 80 ? '...' : ''}
                                </p>

                                {/* Duration */}
                                <div className="flex items-center gap-2 mt-2 text-[10px] text-surface-200/30">
                                    <span>{scene.actualDuration || scene.estimatedDuration}s</span>
                                    {scene.videoUrl && <span className="text-accent-green">● Video</span>}
                                    {scene.audioUrl && <span className="text-accent-blue">● Audio</span>}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </aside>
    );
}
