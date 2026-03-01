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
            return 'bg-success/20 text-success border-success/30';
        case 'processing':
            return 'bg-primary-400/20 text-primary-300 border-primary-400/30 animate-pulse-glow';
        case 'failed':
            return 'bg-danger/20 text-danger border-danger/30';
        default:
            return 'bg-navy-700/50 text-slate-500 border-navy-700/30';
    }
}

function getStatusDot(status: string) {
    switch (status) {
        case 'completed':
            return 'bg-success';
        case 'processing':
            return 'bg-primary-400 animate-pulse';
        case 'failed':
            return 'bg-danger';
        default:
            return 'bg-slate-600';
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
        <aside className="w-72 shrink-0 glass-card rounded-2xl flex flex-col overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-white/5">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
                        Projects
                    </h2>
                    <button
                        onClick={onNewStoryboard}
                        className="text-xs px-3 py-1.5 rounded-lg bg-primary-500/15 text-primary-300 hover:bg-primary-500/25 transition-colors border border-primary-500/20"
                    >
                        + New
                    </button>
                </div>

                {/* Storyboard list */}
                <div className="space-y-1 max-h-32 overflow-y-auto">
                    {storyboards.length === 0 ? (
                        <p className="text-xs text-slate-600 italic py-2">
                            No projects yet
                        </p>
                    ) : (
                        storyboards.map((sb) => (
                            <button
                                key={sb.id}
                                onClick={() => onSelectStoryboard(sb)}
                                className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all ${selectedStoryboard?.id === sb.id
                                    ? 'bg-primary-500/15 text-primary-200 border border-primary-500/25'
                                    : 'text-slate-500 hover:bg-white/5 border border-transparent'
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
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                        Scenes ({selectedStoryboard.scenes?.length || 0})
                    </h3>

                    <div className="space-y-2">
                        {selectedStoryboard.scenes?.map((scene, index) => (
                            <button
                                key={scene.id}
                                onClick={() => onSelectScene(scene)}
                                className={`w-full text-left p-3 rounded-xl transition-all group ${selectedScene?.id === scene.id
                                    ? 'bg-primary-500/10 border border-primary-500/25 shadow-lg shadow-primary-500/5'
                                    : 'hover:bg-white/5 border border-transparent'
                                    }`}
                            >
                                {/* Scene number + status */}
                                <div className="flex items-center justify-between mb-1.5">
                                    <span className="text-[10px] font-mono text-slate-600 uppercase">
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
                                <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                                    {scene.narration?.substring(0, 80)}
                                    {(scene.narration?.length || 0) > 80 ? '...' : ''}
                                </p>

                                {/* Duration */}
                                <div className="flex items-center gap-2 mt-2 text-[10px] text-slate-600">
                                    <span>{scene.actualDuration || scene.estimatedDuration}s</span>
                                    {scene.videoUrl && <span className="text-success">● Video</span>}
                                    {scene.audioUrl && <span className="text-info">● Audio</span>}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </aside>
    );
}
