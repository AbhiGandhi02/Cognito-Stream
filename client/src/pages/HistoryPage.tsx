/**
 * HistoryPage — full list of the user's prior storyboards with metadata.
 * The dashboard sidebar shows just titles; this page is the "view all"
 * destination with status, scene counts, and quick-open links.
 */

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, RefreshCcw, Search, Film, Clock, Pencil, Trash2, Check, X } from 'lucide-react';
import { api, type Storyboard } from '../services/api';
import { resolveFinalVideoUrl } from '../data/demos';

function statusPill(status: string): { label: string; className: string } {
    switch (status) {
        case 'completed':
            return { label: 'Completed', className: 'bg-success/10 text-success border-success/20' };
        case 'processing':
            return { label: 'Processing', className: 'bg-warning/10 text-warning border-warning/20' };
        case 'failed':
            return { label: 'Failed', className: 'bg-danger/10 text-danger border-danger/20' };
        case 'draft':
            return { label: 'Draft', className: 'bg-white/8 text-slate-300 border-white/15' };
        default:
            return { label: status, className: 'bg-white/8 text-slate-400 border-white/15' };
    }
}

function timeAgo(iso?: string | null): string {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const diff = Date.now() - then;
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
}

export function HistoryPage() {
    const navigate = useNavigate();
    const [storyboards, setStoryboards] = useState<Storyboard[]>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState('');
    const [error, setError] = useState<string>();

    // Per-row interaction state.
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [savingId, setSavingId] = useState<string | null>(null);
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    const editInputRef = useRef<HTMLInputElement | null>(null);

    // Focus the rename input when entering edit mode.
    useEffect(() => {
        if (editingId && editInputRef.current) {
            editInputRef.current.focus();
            editInputRef.current.select();
        }
    }, [editingId]);

    const startRename = (sb: Storyboard) => {
        setEditingId(sb.id);
        setEditTitle(sb.title || '');
    };

    const cancelRename = () => {
        setEditingId(null);
        setEditTitle('');
    };

    const commitRename = async (sb: Storyboard) => {
        const trimmed = editTitle.trim();
        if (!trimmed || trimmed === sb.title) {
            cancelRename();
            return;
        }
        setSavingId(sb.id);
        try {
            const updated = await api.updateStoryboard(sb.id, { title: trimmed });
            setStoryboards((prev) => prev.map((s) => (s.id === sb.id ? { ...s, title: updated.title } : s)));
            cancelRename();
        } catch (err) {
            setError(`Rename failed: ${(err as Error).message}`);
        } finally {
            setSavingId(null);
        }
    };

    const confirmDelete = async (sb: Storyboard) => {
        setSavingId(sb.id);
        try {
            await api.deleteStoryboard(sb.id);
            setStoryboards((prev) => prev.filter((s) => s.id !== sb.id));
            setPendingDeleteId(null);
        } catch (err) {
            setError(`Delete failed: ${(err as Error).message}`);
        } finally {
            setSavingId(null);
        }
    };

    useEffect(() => {
        let active = true;
        (async () => {
            setLoading(true);
            try {
                const data = await api.listStoryboards({ limit: 200 });
                if (!active) return;
                setStoryboards(data.data || []);
            } catch (err) {
                if (active) setError((err as Error).message);
            } finally {
                if (active) setLoading(false);
            }
        })();
        return () => {
            active = false;
        };
    }, []);

    const filtered = query.trim()
        ? storyboards.filter((sb) =>
            (sb.title || '').toLowerCase().includes(query.toLowerCase())
        )
        : storyboards;

    return (
        <div className="min-h-screen bg-navy-950 text-slate-100">
            {/* Header */}
            <header className="sticky top-0 z-30 backdrop-blur-md bg-navy-950/70 border-b border-white/5">
                <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
                    <button
                        onClick={() => navigate('/dashboard')}
                        className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-100 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to dashboard
                    </button>
                    <Link
                        to="/dashboard"
                        className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                    >
                        New chat
                    </Link>
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-6 pt-10 pb-20">
                {/* Title */}
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                    className="mb-8"
                >
                    <h1 className="text-3xl md:text-4xl font-bold tracking-[-0.02em] text-slate-100 mb-2">
                        History
                    </h1>
                    <p className="text-sm md:text-base text-slate-500">
                        Every storyboard you've generated. {storyboards.length > 0 && `${storyboards.length} total.`}
                    </p>
                </motion.div>

                {/* Search */}
                <div className="relative mb-6">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search by title…"
                        className="w-full rounded-xl border border-white/8 bg-white/3 backdrop-blur-md pl-10 pr-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-white/20 transition-colors"
                    />
                </div>

                {/* Error */}
                {error && (
                    <div className="rounded-xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger mb-6">
                        {error}
                    </div>
                )}

                {/* List */}
                {loading ? (
                    <div className="flex items-center justify-center py-20 text-slate-500 text-sm gap-2">
                        <RefreshCcw className="w-4 h-4 animate-spin" />
                        Loading history…
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="rounded-2xl border border-white/8 bg-white/3 backdrop-blur-md px-6 py-16 text-center">
                        <Film className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                        <p className="text-sm text-slate-400">
                            {query ? 'No storyboards match that search.' : 'No storyboards yet — generate your first one from the dashboard.'}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2.5">
                        {filtered.map((sb, i) => {
                            const pill = statusPill(sb.status);
                            const sceneCount = sb.scenes?.length || 0;
                            const isEditing = editingId === sb.id;
                            const isSaving = savingId === sb.id;
                            return (
                                <motion.div
                                    key={sb.id}
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.3, delay: Math.min(i * 0.02, 0.4) }}
                                    role="button"
                                    tabIndex={isEditing ? -1 : 0}
                                    onClick={() => {
                                        if (isEditing) return;
                                        navigate(`/dashboard/${sb.id}`);
                                    }}
                                    onKeyDown={(e) => {
                                        if (isEditing) return;
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            navigate(`/dashboard/${sb.id}`);
                                        }
                                    }}
                                    className="w-full group text-left rounded-xl border border-white/8 bg-white/3 backdrop-blur-md hover:border-white/20 hover:bg-white/5 transition-colors p-5 flex items-center gap-4 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                                >
                                    {/* Thumbnail */}
                                    <div className="shrink-0 w-20 h-12 rounded-md overflow-hidden border border-white/8 bg-navy-900 flex items-center justify-center">
                                        {resolveFinalVideoUrl(sb) ? (
                                            <video
                                                src={resolveFinalVideoUrl(sb)!}
                                                muted
                                                playsInline
                                                preload="metadata"
                                                aria-hidden="true"
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <Film className="w-4 h-4 text-slate-600" />
                                        )}
                                    </div>

                                    {/* Body */}
                                    <div className="min-w-0 flex-1">
                                        {isEditing ? (
                                            <div
                                                className="flex items-center gap-2"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <input
                                                    ref={editInputRef}
                                                    value={editTitle}
                                                    onChange={(e) => setEditTitle(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            e.preventDefault();
                                                            void commitRename(sb);
                                                        } else if (e.key === 'Escape') {
                                                            e.preventDefault();
                                                            cancelRename();
                                                        }
                                                    }}
                                                    disabled={isSaving}
                                                    className="flex-1 rounded-md border border-white/15 bg-navy-900/70 px-3 py-1.5 text-sm md:text-base text-slate-100 focus:outline-none focus:border-white/30 disabled:opacity-50"
                                                />
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); void commitRename(sb); }}
                                                    disabled={isSaving}
                                                    className="p-1.5 rounded-md text-success hover:bg-white/5 disabled:opacity-40"
                                                    title="Save (Enter)"
                                                >
                                                    {isSaving ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); cancelRename(); }}
                                                    disabled={isSaving}
                                                    className="p-1.5 rounded-md text-slate-400 hover:bg-white/5 hover:text-slate-100"
                                                    title="Cancel (Esc)"
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ) : (
                                            <p className="text-sm md:text-base font-semibold text-slate-100 truncate group-hover:text-white transition-colors">
                                                {sb.title || 'Untitled'}
                                            </p>
                                        )}
                                        {!isEditing && sb.description && (
                                            <p className="text-xs text-slate-500 mt-1 line-clamp-1">
                                                {sb.description}
                                            </p>
                                        )}
                                        {!isEditing && (
                                            <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-500">
                                                <span className="flex items-center gap-1">
                                                    <Film className="w-3 h-3" />
                                                    {sceneCount} {sceneCount === 1 ? 'scene' : 'scenes'}
                                                </span>
                                                {sb.createdAt && (
                                                    <>
                                                        <span className="text-slate-700">·</span>
                                                        <span className="flex items-center gap-1">
                                                            <Clock className="w-3 h-3" />
                                                            {timeAgo(sb.createdAt)}
                                                        </span>
                                                    </>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Status pill */}
                                    {!isEditing && (
                                        <span
                                            className={`shrink-0 text-[10px] uppercase tracking-wider font-semibold px-2.5 py-1 rounded-md border ${pill.className}`}
                                        >
                                            {pill.label}
                                        </span>
                                    )}

                                    {/* Direct edit + delete buttons — always visible
                                        on the row so users don't have to discover a menu. */}
                                    {!isEditing && (
                                        <div
                                            className="flex items-center gap-1 shrink-0"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <button
                                                onClick={(e) => { e.stopPropagation(); startRename(sb); }}
                                                aria-label="Rename storyboard"
                                                title="Rename"
                                                className="p-2 rounded-md text-slate-500 hover:text-slate-100 hover:bg-white/8 transition-colors"
                                            >
                                                <Pencil className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setPendingDeleteId(sb.id); }}
                                                aria-label="Delete storyboard"
                                                title="Delete"
                                                className="p-2 rounded-md text-slate-500 hover:text-danger hover:bg-danger/10 transition-colors"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    )}
                                </motion.div>
                            );
                        })}
                    </div>
                )}
            </main>

            {/* Delete confirmation modal */}
            {pendingDeleteId && (() => {
                const target = storyboards.find((s) => s.id === pendingDeleteId);
                if (!target) return null;
                const busy = savingId === pendingDeleteId;
                return (
                    <div
                        className="fixed inset-0 z-100 flex items-center justify-center px-4 py-8 bg-black/80 backdrop-blur-md"
                        onClick={() => !busy && setPendingDeleteId(null)}
                    >
                        <div
                            className="w-full max-w-md rounded-2xl border border-white/15 bg-navy-900/95 p-6 space-y-4"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-start gap-3">
                                <div className="shrink-0 w-10 h-10 rounded-full bg-danger/15 border border-danger/30 flex items-center justify-center">
                                    <Trash2 className="w-5 h-5 text-danger" />
                                </div>
                                <div className="min-w-0">
                                    <h3 className="text-base font-semibold text-slate-100">
                                        Delete this storyboard?
                                    </h3>
                                    <p className="text-sm text-slate-400 mt-1">
                                        <span className="font-medium text-slate-200">
                                            {target.title || 'Untitled'}
                                        </span>{' '}
                                        and all its scenes will be permanently removed. This cannot be undone.
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center justify-end gap-2 pt-2">
                                <button
                                    onClick={() => setPendingDeleteId(null)}
                                    disabled={busy}
                                    className="btn-secondary text-sm px-4 py-2 disabled:opacity-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => void confirmDelete(target)}
                                    disabled={busy}
                                    className="text-sm px-4 py-2 rounded-lg bg-danger/15 hover:bg-danger/25 border border-danger/30 text-danger font-medium flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    {busy ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                    {busy ? 'Deleting…' : 'Delete'}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
