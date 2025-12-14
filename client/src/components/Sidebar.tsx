import { useState, useEffect } from 'react';
import { api, type Storyboard } from '../services/api';
import { Bars3Icon, XMarkIcon, PlusIcon, TrashIcon, VideoCameraIcon } from '@heroicons/react/24/outline';

interface SidebarProps {
    isOpen: boolean;
    onToggle: () => void;
    currentStoryboardId?: string;
    onSelectStoryboard: (storyboard: Storyboard) => void;
    onNewStoryboard: () => void;
}

const getStatusBadge = (status: string) => {
    switch (status) {
        case 'completed':
            return <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">Done</span>;
        case 'processing':
            return <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">Processing</span>;
        case 'failed':
            return <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-400">Failed</span>;
        default:
            return <span className="rounded-full bg-slate-600/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Draft</span>;
    }
};

const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export const Sidebar = ({
    isOpen,
    onToggle,
    currentStoryboardId,
    onSelectStoryboard,
    onNewStoryboard,
}: SidebarProps) => {
    const [storyboards, setStoryboards] = useState<Storyboard[]>([]);
    const [loading, setLoading] = useState(true);
    const [deleting, setDeleting] = useState<string | null>(null);

    const fetchStoryboards = async () => {
        try {
            const response = await api.listStoryboards({ limit: 50 });
            setStoryboards(response.data || []);
        } catch (error) {
            console.error('Failed to fetch storyboards:', error);
            setStoryboards([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStoryboards();
    }, []);

    useEffect(() => {
        if (currentStoryboardId) {
            fetchStoryboards();
        }
    }, [currentStoryboardId]);

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!window.confirm('Delete this storyboard?')) return;

        setDeleting(id);
        try {
            await api.deleteStoryboard(id);
            setStoryboards((prev) => prev.filter((s) => s.id !== id));
        } catch (error) {
            console.error('Failed to delete storyboard:', error);
        } finally {
            setDeleting(null);
        }
    };

    return (
        <>
            {/* Mobile Toggle */}
            <button
                className="fixed left-4 top-4 z-50 rounded-lg bg-slate-800 p-2 text-white lg:hidden"
                onClick={onToggle}
            >
                {isOpen ? <XMarkIcon className="h-6 w-6" /> : <Bars3Icon className="h-6 w-6" />}
            </button>

            {/* Desktop Toggle */}
            <button
                className="fixed top-4 z-50 hidden rounded-lg bg-slate-800/80 p-2 text-white backdrop-blur-sm transition-all hover:bg-slate-700 lg:block"
                onClick={onToggle}
                style={{ left: isOpen ? '288px' : '16px' }}
            >
                {isOpen ? <XMarkIcon className="h-6 w-6" /> : <Bars3Icon className="h-6 w-6" />}
            </button>

            {/* Mobile Backdrop */}
            {isOpen && (
                <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={onToggle} />
            )}

            {/* Sidebar */}
            <aside
                className={`fixed left-0 top-0 z-40 h-full w-72 transform border-r border-slate-800 bg-slate-950 transition-transform duration-300 ${isOpen ? 'translate-x-0' : '-translate-x-full'
                    }`}
            >
                {/* Header */}
                <div className="flex h-16 items-center justify-between border-b border-slate-800 px-4">
                    <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/20 text-purple-400">
                            <VideoCameraIcon className="h-5 w-5" />
                        </div>
                        <span className="font-semibold text-white">Cognito Stream</span>
                    </div>
                </div>

                {/* New Button */}
                <div className="p-4">
                    <button
                        onClick={onNewStoryboard}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 py-2.5 font-semibold text-white transition-colors hover:bg-purple-700"
                    >
                        <PlusIcon className="h-5 w-5" />
                        New Storyboard
                    </button>
                </div>

                {/* List */}
                <div className="flex-1 overflow-y-auto px-3 pb-4">
                    <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Recent Projects
                    </div>

                    {loading ? (
                        <div className="space-y-2">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-800" />
                            ))}
                        </div>
                    ) : storyboards.length === 0 ? (
                        <div className="px-2 py-8 text-center text-sm text-slate-500">
                            No storyboards yet.
                            <br />
                            Create your first one!
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {storyboards.map((storyboard) => (
                                <div
                                    key={storyboard.id}
                                    className={`group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-200 ${currentStoryboardId === storyboard.id
                                        ? 'bg-purple-600/20 text-purple-400'
                                        : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                                        }`}
                                    onClick={() => onSelectStoryboard(storyboard)}
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="truncate font-medium text-white">
                                                {storyboard.title}
                                            </span>
                                            {getStatusBadge(storyboard.status)}
                                        </div>
                                        <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                                            <span>{storyboard.scenes?.length || 0} scenes</span>
                                            <span>•</span>
                                            <span>{formatDate(storyboard.createdAt)}</span>
                                        </div>
                                    </div>

                                    <button
                                        onClick={(e) => handleDelete(e, storyboard.id)}
                                        disabled={deleting === storyboard.id}
                                        className="ml-2 rounded p-1 text-slate-500 opacity-0 transition-opacity hover:bg-red-500/20 hover:text-red-400 group-hover:opacity-100"
                                    >
                                        {deleting === storyboard.id ? (
                                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-red-400 border-t-transparent" />
                                        ) : (
                                            <TrashIcon className="h-4 w-4" />
                                        )}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="border-t border-slate-800 p-4">
                    <div className="text-center text-xs text-slate-500">
                        Powered by Gemini + Manim
                    </div>
                </div>
            </aside>
        </>
    );
};

export default Sidebar;
