/**
 * CommandPalette — floating Cmd+K / Ctrl+K action menu.
 *
 * Opens as a centered glass-styled overlay with a search input and a list of
 * actions filtered by the search query. Built on `cmdk` (Radix-style command
 * primitive) for keyboard navigation and screen-reader semantics.
 *
 * Actions registered:
 *   - "New project"            → clears the workspace (handleNewStoryboard)
 *   - "Retry all failed scenes" → fires per-scene regenerate for every failed
 *                                  scene in the active storyboard
 *   - "Sign out"               → AuthContext signOut
 *   - "Open admin"             → router push to /admin (if user is admin)
 *   - Recent storyboards       → searchable; selecting one calls onSelectStoryboard
 *
 * The component is fully self-contained — only emits intent via callback props,
 * leaves the actual state mutations to DashboardPage.
 */

import { Command } from 'cmdk';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useMe } from '../hooks/useMe';
import type { Storyboard, Scene } from '../services/api';

interface CommandPaletteProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    storyboards: Storyboard[];
    activeStoryboard: Storyboard | null;
    onSelectStoryboard: (sb: Storyboard) => void;
    onNewStoryboard: () => void;
    onRetryScene: (sceneId: string) => void;
}

export function CommandPalette({
    open,
    onOpenChange,
    storyboards,
    activeStoryboard,
    onSelectStoryboard,
    onNewStoryboard,
    onRetryScene,
}: CommandPaletteProps) {
    const navigate = useNavigate();
    const { signOut } = useAuth();
    const { isAdmin } = useMe();

    // Global Cmd+K / Ctrl+K hotkey
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                onOpenChange(!open);
            } else if (e.key === 'Escape' && open) {
                onOpenChange(false);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [open, onOpenChange]);

    if (!open) return null;

    const failedScenes: Scene[] = activeStoryboard?.scenes?.filter((s) => s.status === 'failed') || [];

    const close = () => onOpenChange(false);

    const run = (action: () => void | Promise<void>) => {
        // Defer so cmdk's selection animation completes before we unmount.
        setTimeout(() => {
            close();
            void action();
        }, 0);
    };

    return (
        <div
            className="fixed inset-0 z-100 flex items-start justify-center pt-[15vh] px-4"
            onClick={close}
        >
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                aria-hidden="true"
            />

            <div
                className="relative w-full max-w-xl"
                onClick={(e) => e.stopPropagation()}
            >
                <Command
                    label="Command Menu"
                    className="rounded-2xl border border-white/10 bg-white/4 backdrop-blur-2xl shadow-2xl shadow-black/50 overflow-hidden"
                    style={{ boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.08), 0 24px 48px rgba(0,0,0,0.6)' }}
                >
                    <Command.Input
                        autoFocus
                        placeholder="Type a command or search projects..."
                        className="w-full px-5 py-4 bg-transparent text-[15px] text-white placeholder-white/30 focus:outline-none border-b border-white/5"
                    />

                    <Command.List className="max-h-[420px] overflow-y-auto p-2">
                        <Command.Empty className="py-8 text-center text-sm text-white/40">
                            No matching commands.
                        </Command.Empty>

                        <Command.Group heading="Actions" className="text-[10px] uppercase tracking-widest text-white/30 px-3 py-1.5">
                            <CmdItem
                                hint="N"
                                onSelect={() => run(onNewStoryboard)}
                            >
                                <span className="text-white/85">New project</span>
                                <span className="text-white/40 text-xs">Clear workspace and start a new storyboard</span>
                            </CmdItem>

                            {failedScenes.length > 0 && (
                                <CmdItem
                                    hint={`${failedScenes.length} retry${failedScenes.length === 1 ? '' : 's'}`}
                                    onSelect={() => run(async () => {
                                        // Run sequentially so the orchestrator doesn't
                                        // get pounded by parallel retries.
                                        for (const s of failedScenes) {
                                            try { await onRetryScene(s.id); } catch { /* keep going */ }
                                        }
                                    })}
                                >
                                    <span className="text-white/85">Retry all failed scenes</span>
                                    <span className="text-white/40 text-xs">{failedScenes.length} scene{failedScenes.length === 1 ? '' : 's'} in the current storyboard</span>
                                </CmdItem>
                            )}

                            {isAdmin && (
                                <CmdItem hint="A" onSelect={() => run(() => navigate('/admin'))}>
                                    <span className="text-white/85">Open admin dashboard</span>
                                    <span className="text-white/40 text-xs">Diagnostics and prompt history</span>
                                </CmdItem>
                            )}

                            <CmdItem hint="↩" onSelect={() => run(() => signOut())}>
                                <span className="text-white/85">Sign out</span>
                                <span className="text-white/40 text-xs">End your session</span>
                            </CmdItem>
                        </Command.Group>

                        {storyboards.length > 0 && (
                            <Command.Group heading="Recent projects" className="text-[10px] uppercase tracking-widest text-white/30 px-3 py-1.5 mt-2">
                                {storyboards.slice(0, 12).map((sb) => (
                                    <CmdItem
                                        key={sb.id}
                                        value={`storyboard ${sb.title} ${sb.prompt || ''}`}
                                        onSelect={() => run(() => onSelectStoryboard(sb))}
                                    >
                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                            <div
                                                className={`w-1.5 h-1.5 rounded-full shrink-0 ${sb.status === 'completed'
                                                    ? 'bg-success'
                                                    : sb.status === 'processing'
                                                        ? 'bg-warning animate-pulse'
                                                        : sb.status === 'failed'
                                                            ? 'bg-danger'
                                                            : 'bg-white/30'
                                                    }`}
                                            />
                                            <span className="text-white/85 truncate">{sb.title || 'Untitled'}</span>
                                        </div>
                                        <span className="text-white/40 text-xs whitespace-nowrap">
                                            {sb.scenes?.length || 0} scene{(sb.scenes?.length ?? 0) === 1 ? '' : 's'}
                                        </span>
                                    </CmdItem>
                                ))}
                            </Command.Group>
                        )}
                    </Command.List>

                    <div className="px-4 py-2 border-t border-white/5 flex items-center justify-between text-[10px] text-white/30">
                        <span>↑↓ navigate · ↵ run · esc close</span>
                        <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-white/50 font-mono">
                            ⌘K
                        </kbd>
                    </div>
                </Command>
            </div>
        </div>
    );
}

/**
 * Single command row. Highlighted automatically by cmdk on hover/keyboard
 * navigation via the `[data-selected="true"]` attribute selector.
 */
function CmdItem({
    children,
    onSelect,
    hint,
    value,
}: {
    children: React.ReactNode;
    onSelect: () => void;
    hint?: string;
    value?: string;
}) {
    return (
        <Command.Item
            value={value}
            onSelect={onSelect}
            className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg cursor-pointer text-sm transition-colors data-[selected=true]:bg-white/8 data-[selected=true]:text-white"
        >
            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                {children}
            </div>
            {hint && (
                <kbd className="text-[10px] text-white/40 font-mono px-1.5 py-0.5 rounded bg-white/5 border border-white/10 shrink-0">
                    {hint}
                </kbd>
            )}
        </Command.Item>
    );
}
