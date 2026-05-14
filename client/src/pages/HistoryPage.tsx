/**
 * HistoryPage — full list of the user's prior storyboards with metadata.
 * The dashboard sidebar shows just titles; this page is the "view all"
 * destination with status, scene counts, and quick-open links.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, RefreshCcw, Search, Film, Clock } from 'lucide-react';
import { api, type Storyboard } from '../services/api';

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
                            return (
                                <motion.button
                                    key={sb.id}
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.3, delay: Math.min(i * 0.02, 0.4) }}
                                    onClick={() => navigate('/dashboard', { state: { resumeStoryboardId: sb.id } })}
                                    className="w-full group text-left rounded-xl border border-white/8 bg-white/3 backdrop-blur-md hover:border-white/20 hover:bg-white/5 transition-colors p-5 flex items-center gap-4"
                                >
                                    {/* Thumbnail */}
                                    <div className="shrink-0 w-20 h-12 rounded-md overflow-hidden border border-white/8 bg-navy-900 flex items-center justify-center">
                                        {sb.finalVideoUrl ? (
                                            <video
                                                src={sb.finalVideoUrl}
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
                                        <p className="text-sm md:text-base font-semibold text-slate-100 truncate group-hover:text-white transition-colors">
                                            {sb.title || 'Untitled'}
                                        </p>
                                        {sb.description && (
                                            <p className="text-xs text-slate-500 mt-1 line-clamp-1">
                                                {sb.description}
                                            </p>
                                        )}
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
                                    </div>

                                    {/* Status pill */}
                                    <span
                                        className={`shrink-0 text-[10px] uppercase tracking-wider font-semibold px-2.5 py-1 rounded-md border ${pill.className}`}
                                    >
                                        {pill.label}
                                    </span>
                                </motion.button>
                            );
                        })}
                    </div>
                )}
            </main>
        </div>
    );
}
