/**
 * AdminPage — admin-only diagnostic dashboard.
 *
 * Two-pane layout: list of users on the left, the selected user's
 * storyboards on the right. Each storyboard expands to show the user's
 * original prompt, overall status, top-level error if any, and a per-scene
 * trail (status, error message, correction attempts).
 *
 * Deliberately does NOT surface video URLs — admins read prompts and
 * outcomes; users own their videos.
 */

import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../services/api';
import { useMe } from '../hooks/useMe';
import {
    ArrowLeft,
    Shield,
    Users,
    AlertCircle,
    Clock,
    Film,
    CheckCircle2,
    XCircle,
    Loader2,
    ChevronDown,
    ChevronRight,
    RefreshCcw,
} from 'lucide-react';

interface UserRow {
    id: string;
    email: string;
    name: string | null;
    role: 'USER' | 'ADMIN';
    createdAt: string;
    storyboardCount: number;
    lastStoryboardAt: string | null;
}

interface SceneDiag {
    id: string;
    sceneNumber: number;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    narration: string;
    visualDescription: string;
    errorMessage: string | null;
    correctionAttempts: number;
    actualDuration: number | null;
    estimatedDuration: number;
}

interface StoryboardDiag {
    id: string;
    title: string;
    prompt: string;
    description: string;
    status: 'draft' | 'processing' | 'completed' | 'failed';
    errorMessage: string | null;
    totalDuration: number | null;
    createdAt: string;
    updatedAt: string;
    scenes: SceneDiag[];
}

function formatRelative(iso: string): string {
    const date = new Date(iso);
    const ms = Date.now() - date.getTime();
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function StatusBadge({ status }: { status: string }) {
    const styles: Record<string, string> = {
        completed: 'bg-success/15 border-success/30 text-success',
        processing: 'bg-warning/15 border-warning/30 text-warning',
        failed: 'bg-danger/15 border-danger/30 text-danger',
        draft: 'bg-white/5 border-white/10 text-slate-400',
        pending: 'bg-white/5 border-white/10 text-slate-500',
    };
    const Icon =
        status === 'completed'
            ? CheckCircle2
            : status === 'failed'
                ? XCircle
                : status === 'processing'
                    ? Loader2
                    : Clock;
    return (
        <span
            className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-md border ${styles[status] || styles.draft}`}
        >
            <Icon className={`w-3 h-3 ${status === 'processing' ? 'animate-spin' : ''}`} />
            {status}
        </span>
    );
}

function SceneRow({ scene }: { scene: SceneDiag }) {
    const failed = scene.status === 'failed';
    return (
        <div
            className={`rounded-md border px-3 py-2.5 ${failed
                ? 'border-danger/20 bg-danger/4'
                : 'border-white/5 bg-white/1.5'
                }`}
        >
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-navy-900/80 border border-white/10 text-[10px] font-semibold text-slate-300 flex items-center justify-center">
                        {scene.sceneNumber}
                    </span>
                    <p className="text-xs text-slate-400 truncate">
                        {scene.visualDescription || scene.narration}
                    </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {scene.correctionAttempts > 0 && (
                        <span className="text-[10px] text-slate-500 flex items-center gap-1" title="AI correction attempts">
                            <RefreshCcw className="w-2.5 h-2.5" />
                            {scene.correctionAttempts}
                        </span>
                    )}
                    <StatusBadge status={scene.status} />
                </div>
            </div>
            {scene.errorMessage && (
                <pre className="mt-2 text-[11px] text-danger/90 bg-danger/6 border border-danger/20 rounded px-2 py-1.5 whitespace-pre-wrap wrap-break-word font-mono leading-relaxed">
                    {scene.errorMessage}
                </pre>
            )}
        </div>
    );
}

function StoryboardCard({ sb }: { sb: StoryboardDiag }) {
    const [expanded, setExpanded] = useState(false);
    const failedScenes = sb.scenes.filter((s) => s.status === 'failed').length;
    const totalCorrections = sb.scenes.reduce(
        (sum, s) => sum + (s.correctionAttempts || 0),
        0
    );

    return (
        <div className="glass-card rounded-xl overflow-hidden">
            {/* Summary row (always visible) */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full text-left px-4 py-3 hover:bg-white/1 transition-colors"
            >
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1.5">
                        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-medium">
                            Prompt
                        </p>
                        <p className="text-sm text-slate-200 line-clamp-2 font-medium">
                            {sb.prompt}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <StatusBadge status={sb.status} />
                        {expanded ? (
                            <ChevronDown className="w-4 h-4 text-slate-500" />
                        ) : (
                            <ChevronRight className="w-4 h-4 text-slate-500" />
                        )}
                    </div>
                </div>

                {/* Stats row */}
                <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-slate-500">
                    <span className="flex items-center gap-1">
                        <Film className="w-3 h-3" />
                        {sb.scenes.length} scenes
                    </span>
                    {failedScenes > 0 && (
                        <span className="flex items-center gap-1 text-danger">
                            <XCircle className="w-3 h-3" />
                            {failedScenes} failed
                        </span>
                    )}
                    {totalCorrections > 0 && (
                        <span className="flex items-center gap-1" title="Total AI correction attempts">
                            <RefreshCcw className="w-3 h-3" />
                            {totalCorrections} corrections
                        </span>
                    )}
                    <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatRelative(sb.createdAt)}
                    </span>
                </div>
            </button>

            {/* Expanded body */}
            {expanded && (
                <div className="border-t border-white/5 px-4 py-4 space-y-3">
                    {/* Top-level error */}
                    {sb.errorMessage && (
                        <div className="rounded-md border border-danger/20 bg-danger/6 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-widest text-danger font-medium mb-1 flex items-center gap-1.5">
                                <AlertCircle className="w-3 h-3" />
                                Pipeline error
                            </p>
                            <pre className="text-[11px] text-danger/90 whitespace-pre-wrap wrap-break-word font-mono leading-relaxed">
                                {sb.errorMessage}
                            </pre>
                        </div>
                    )}

                    {/* Per-scene trail */}
                    <div className="space-y-2">
                        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-medium">
                            Scene breakdown
                        </p>
                        {sb.scenes.map((scene) => (
                            <SceneRow key={scene.id} scene={scene} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

export function AdminPage() {
    const navigate = useNavigate();
    const { me, loading: meLoading, isAdmin } = useMe();

    const [users, setUsers] = useState<UserRow[]>([]);
    const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
    const [userStoryboards, setUserStoryboards] = useState<StoryboardDiag[]>([]);
    const [usersLoading, setUsersLoading] = useState(false);
    const [storyboardsLoading, setStoryboardsLoading] = useState(false);
    const [error, setError] = useState<string>();

    // Bounce non-admins away from the admin page.
    useEffect(() => {
        if (!meLoading && me && !isAdmin) {
            navigate('/dashboard', { replace: true });
        }
    }, [meLoading, me, isAdmin, navigate]);

    // Load user list once we know we're admin.
    useEffect(() => {
        if (!isAdmin) return;
        setUsersLoading(true);
        api.adminListUsers({ limit: 200 })
            .then((res) => {
                setUsers(res.data);
                if (res.data.length > 0 && !selectedUserId) {
                    setSelectedUserId(res.data[0].id);
                }
            })
            .catch((err) => setError((err as Error).message))
            .finally(() => setUsersLoading(false));
    }, [isAdmin, selectedUserId]);

    // Load selected user's storyboards (with full diagnostic detail).
    useEffect(() => {
        if (!selectedUserId) {
            setUserStoryboards([]);
            return;
        }
        setStoryboardsLoading(true);
        api.adminListUserStoryboards(selectedUserId)
            .then((res) => setUserStoryboards(res.storyboards))
            .catch((err) => setError((err as Error).message))
            .finally(() => setStoryboardsLoading(false));
    }, [selectedUserId]);

    const selectedUser = users.find((u) => u.id === selectedUserId);

    if (meLoading) {
        return (
            <div className="min-h-screen bg-navy-950 flex items-center justify-center text-sm text-slate-500">
                Loading…
            </div>
        );
    }
    if (!isAdmin) return null; // useEffect will redirect

    return (
        <div className="min-h-screen bg-navy-950 text-slate-100 flex flex-col">
            {/* Header */}
            <header className="sticky top-0 z-50 border-b border-white/5 bg-navy-950/85 backdrop-blur-md px-6 py-3">
                <div className="max-w-6xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Link to="/" className="p-2 rounded-md text-slate-400 hover:text-slate-100 hover:bg-white/5 transition-colors">
                            <ArrowLeft className="w-4 h-4" />
                        </Link>
                        <div className="flex items-center gap-2">
                            <Shield className="w-4 h-4 text-primary-400" />
                            <h1 className="text-sm font-medium text-slate-200">Admin · diagnostics</h1>
                        </div>
                    </div>
                    <span className="text-xs text-slate-500 truncate max-w-40" title={me?.email}>
                        {me?.email}
                    </span>
                </div>
            </header>

            <main className="flex-1 px-6 py-8">
                <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6">
                    {/* Users list */}
                    <aside className="glass-card rounded-xl p-3 space-y-1 h-fit max-h-[80vh] overflow-y-auto sticky top-20">
                        <div className="flex items-center gap-2 px-3 py-2 text-xs uppercase tracking-widest text-slate-500">
                            <Users className="w-3.5 h-3.5" />
                            Users · {users.length}
                        </div>
                        {usersLoading && <p className="px-3 py-2 text-xs text-slate-600">Loading…</p>}
                        {!usersLoading && users.length === 0 && (
                            <p className="px-3 py-2 text-xs text-slate-600">No users yet.</p>
                        )}
                        {users.map((u) => (
                            <button
                                key={u.id}
                                onClick={() => setSelectedUserId(u.id)}
                                className={`w-full text-left px-3 py-2 rounded-md transition-colors ${selectedUserId === u.id
                                    ? 'bg-primary-500/15 border border-primary-500/30'
                                    : 'hover:bg-white/2 border border-transparent'
                                    }`}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-medium text-slate-200 truncate">
                                        {u.email}
                                    </span>
                                    {u.role === 'ADMIN' && (
                                        <span className="shrink-0 text-[10px] uppercase tracking-wider text-primary-300 bg-primary-500/15 border border-primary-500/30 rounded px-1.5 py-px">
                                            Admin
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center justify-between gap-2 mt-1">
                                    <span className="text-[11px] text-slate-500">
                                        {u.storyboardCount} {u.storyboardCount === 1 ? 'video' : 'videos'}
                                    </span>
                                    {u.lastStoryboardAt && (
                                        <span className="text-[11px] text-slate-600">
                                            {formatRelative(u.lastStoryboardAt)}
                                        </span>
                                    )}
                                </div>
                            </button>
                        ))}
                    </aside>

                    {/* Right pane — selected user's diagnostic timeline */}
                    <section className="space-y-4">
                        {selectedUser && (
                            <div className="space-y-1">
                                <p className="text-xs uppercase tracking-widest text-primary-400 font-medium">
                                    Activity
                                </p>
                                <h2 className="text-lg font-semibold text-slate-100 truncate">
                                    {selectedUser.email}
                                </h2>
                                <p className="text-xs text-slate-500">
                                    {selectedUser.storyboardCount} videos generated
                                    {selectedUser.lastStoryboardAt && ` · last ${formatRelative(selectedUser.lastStoryboardAt)}`}
                                </p>
                            </div>
                        )}

                        {error && (
                            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger flex items-center gap-2">
                                <AlertCircle className="w-3.5 h-3.5" />
                                {error}
                            </div>
                        )}

                        {!selectedUserId && (
                            <p className="text-sm text-slate-500">Pick a user on the left.</p>
                        )}

                        {selectedUserId && storyboardsLoading && (
                            <p className="text-sm text-slate-500">Loading…</p>
                        )}

                        {selectedUserId && !storyboardsLoading && userStoryboards.length === 0 && (
                            <p className="text-sm text-slate-500">No videos generated yet.</p>
                        )}

                        <div className="space-y-3">
                            {userStoryboards.map((sb) => (
                                <StoryboardCard key={sb.id} sb={sb} />
                            ))}
                        </div>
                    </section>
                </div>
            </main>
        </div>
    );
}
