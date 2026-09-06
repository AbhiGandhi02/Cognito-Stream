/**
 * VideoPlayer — custom-chrome video player used for rendered scenes and the
 * final assembled video.
 *
 * Native `controls` are deliberately off: the browser chrome ignores the app's
 * glass/dark styling and can't be themed. Everything below (scrubber, volume,
 * speed, PiP, fullscreen) is rebuilt so the player matches the rest of the UI
 * in both themes.
 *
 * Two sizes:
 *   - default  — full control bar (dashboard, modals)
 *   - compact  — trimmed bar for small boxes (thumbnails, side panels)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    Play,
    Pause,
    Maximize2,
    Minimize2,
    Volume2,
    Volume1,
    VolumeX,
    Loader2,
    RotateCcw,
    RotateCw,
    PictureInPicture2,
    Gauge,
    AlertTriangle,
    RefreshCcw,
    Film,
} from 'lucide-react';

interface VideoPlayerProps {
    videoUrl: string | null | undefined;
    title?: string;
    /** Still shown before the first frame decodes. */
    poster?: string | null;
    className?: string;
    /** Trimmed control bar for small surfaces. */
    compact?: boolean;
    /** Start playing as soon as the video is ready (muted is not forced —
     *  browsers may refuse; the poster + play button stay as the fallback). */
    autoPlay?: boolean;
    loop?: boolean;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** mm:ss (or h:mm:ss past an hour). NaN/Infinity render as `--:--`. */
function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
    return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

export function VideoPlayer({
    videoUrl,
    title,
    poster,
    className = '',
    compact = false,
    autoPlay = false,
    loop = false,
}: VideoPlayerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const shellRef = useRef<HTMLDivElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const speedRef = useRef<HTMLDivElement>(null);
    const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [current, setCurrent] = useState(0);
    const [buffered, setBuffered] = useState(0);
    const [waiting, setWaiting] = useState(false);
    const [errored, setErrored] = useState(false);
    const [ended, setEnded] = useState(false);
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(false);
    const [rate, setRate] = useState(1);
    const [speedOpen, setSpeedOpen] = useState(false);
    const [fullscreen, setFullscreen] = useState(false);
    const [controlsVisible, setControlsVisible] = useState(true);
    const [scrubbing, setScrubbing] = useState(false);
    const [hoverRatio, setHoverRatio] = useState<number | null>(null);
    const [toast, setToast] = useState<string | null>(null);
    const [reloadKey, setReloadKey] = useState(0);

    const fullVideoUrl = videoUrl
        ? videoUrl.startsWith('http')
            ? videoUrl
            : `${import.meta.env.VITE_API_URL || 'http://localhost:3000'}${videoUrl}`
        : null;

    // ---- transient center toast (seek/volume/speed feedback) --------------
    const flash = useCallback((msg: string) => {
        setToast(msg);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 700);
    }, []);

    // ---- controls auto-hide ----------------------------------------------
    // Controls stay pinned whenever the video isn't playing, the speed menu is
    // open, or the user is scrubbing — hiding them mid-drag is maddening.
    const keepControls = !isPlaying || scrubbing || speedOpen || errored;

    // Every unhide restarts the countdown. Only ever driven from real events
    // (pointer move, key press, playback start) so there's no setState-in-effect
    // cascade; the pinned cases above are derived, not stored.
    const nudgeControls = useCallback(() => {
        setControlsVisible(true);
        if (hideTimer.current) clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => setControlsVisible(false), 2600);
    }, []);

    useEffect(() => () => {
        if (hideTimer.current) clearTimeout(hideTimer.current);
        if (toastTimer.current) clearTimeout(toastTimer.current);
    }, []);

    // Close the speed menu on any click outside it (including elsewhere in the
    // player) — otherwise it lingers over the frame.
    useEffect(() => {
        if (!speedOpen) return;
        const onDown = (e: PointerEvent) => {
            if (!speedRef.current?.contains(e.target as Node)) setSpeedOpen(false);
        };
        document.addEventListener('pointerdown', onDown);
        return () => document.removeEventListener('pointerdown', onDown);
    }, [speedOpen]);

    // ---- fullscreen sync (covers Esc and the browser's own UI) ------------
    useEffect(() => {
        const onChange = () => setFullscreen(document.fullscreenElement === shellRef.current);
        document.addEventListener('fullscreenchange', onChange);
        return () => document.removeEventListener('fullscreenchange', onChange);
    }, []);

    // ---- imperative helpers ----------------------------------------------
    const togglePlay = useCallback(() => {
        const v = videoRef.current;
        if (!v) return;
        if (v.paused || v.ended) {
            void v.play().catch(() => { /* autoplay policy — user can retry */ });
        } else {
            v.pause();
        }
    }, []);

    const seekTo = useCallback((time: number) => {
        const v = videoRef.current;
        if (!v || !Number.isFinite(v.duration)) return;
        const next = Math.min(Math.max(time, 0), v.duration);
        v.currentTime = next;
        setCurrent(next);
    }, []);

    const skip = useCallback((delta: number) => {
        const v = videoRef.current;
        if (!v) return;
        seekTo(v.currentTime + delta);
        flash(`${delta > 0 ? '+' : ''}${delta}s`);
    }, [seekTo, flash]);

    const applyVolume = useCallback((next: number) => {
        const v = videoRef.current;
        if (!v) return;
        const clamped = Math.min(Math.max(next, 0), 1);
        v.volume = clamped;
        v.muted = clamped === 0;
        setVolume(clamped);
        setMuted(clamped === 0);
    }, []);

    const toggleMute = useCallback(() => {
        const v = videoRef.current;
        if (!v) return;
        // Un-muting at zero volume would stay silent — restore an audible level.
        if (v.muted || v.volume === 0) {
            v.muted = false;
            if (v.volume === 0) { v.volume = 0.6; setVolume(0.6); }
            setMuted(false);
        } else {
            v.muted = true;
            setMuted(true);
        }
    }, []);

    const applyRate = useCallback((next: number) => {
        const v = videoRef.current;
        if (!v) return;
        v.playbackRate = next;
        setRate(next);
        setSpeedOpen(false);
        flash(`${next}×`);
        nudgeControls();
    }, [flash, nudgeControls]);

    const toggleFullscreen = useCallback(() => {
        const shell = shellRef.current;
        if (!shell) return;
        if (document.fullscreenElement) {
            void document.exitFullscreen().catch(() => { /* ignore */ });
        } else {
            // Fullscreen the shell, not the <video>, so custom controls come along.
            void shell.requestFullscreen().catch(() => { /* ignore */ });
        }
    }, []);

    const togglePip = useCallback(async () => {
        const v = videoRef.current;
        if (!v || !document.pictureInPictureEnabled) return;
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            } else {
                await v.requestPictureInPicture();
            }
        } catch { /* denied or unsupported — no-op */ }
    }, []);

    // ---- scrubbing --------------------------------------------------------
    const ratioFromEvent = useCallback((clientX: number) => {
        const rect = trackRef.current?.getBoundingClientRect();
        if (!rect || rect.width === 0) return 0;
        return Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    }, []);

    const onTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!duration) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setScrubbing(true);
        seekTo(ratioFromEvent(e.clientX) * duration);
    };

    const onTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const ratio = ratioFromEvent(e.clientX);
        setHoverRatio(ratio);
        if (scrubbing && duration) seekTo(ratio * duration);
    };

    const endScrub = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!scrubbing) return;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
        }
        setScrubbing(false);
        nudgeControls();
    };

    // ---- keyboard ---------------------------------------------------------
    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        // Let the volume slider keep its own arrow-key behaviour.
        if ((e.target as HTMLElement).tagName === 'INPUT') return;
        const v = videoRef.current;
        switch (e.key) {
            case ' ':
            case 'k':
                e.preventDefault(); togglePlay(); break;
            case 'ArrowRight': e.preventDefault(); skip(5); break;
            case 'ArrowLeft': e.preventDefault(); skip(-5); break;
            case 'l': e.preventDefault(); skip(10); break;
            case 'j': e.preventDefault(); skip(-10); break;
            case 'ArrowUp': e.preventDefault(); applyVolume((v?.volume ?? volume) + 0.1); flash(`${Math.round(Math.min((v?.volume ?? volume) + 0.1, 1) * 100)}%`); break;
            case 'ArrowDown': e.preventDefault(); applyVolume((v?.volume ?? volume) - 0.1); flash(`${Math.round(Math.max((v?.volume ?? volume) - 0.1, 0) * 100)}%`); break;
            case 'm': e.preventDefault(); toggleMute(); break;
            case 'f': e.preventDefault(); toggleFullscreen(); break;
            case 'Home': e.preventDefault(); seekTo(0); break;
            case 'End': e.preventDefault(); seekTo(duration); break;
            default:
                if (/^[0-9]$/.test(e.key) && duration) {
                    e.preventDefault();
                    seekTo((Number(e.key) / 10) * duration);
                }
        }
        nudgeControls();
    };

    // ---- empty state ------------------------------------------------------
    if (!fullVideoUrl) {
        return (
            <div
                className={`relative rounded-2xl overflow-hidden bg-navy-900/60 border border-primary-500/5 flex flex-col items-center justify-center text-slate-500 ${className}`}
                style={{ minHeight: compact ? 160 : 300 }}
            >
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_60%_at_50%_40%,rgba(255,255,255,0.05),transparent_70%)]" />
                <div className="relative flex flex-col items-center">
                    <div className="w-14 h-14 rounded-2xl border border-white/10 bg-white/4 flex items-center justify-center mb-3">
                        <Film className="w-6 h-6 opacity-40" />
                    </div>
                    <p className="text-sm font-medium">No video available</p>
                    <p className="text-xs mt-1 opacity-60">Generate scenes to preview</p>
                </div>
            </div>
        );
    }

    const progress = duration > 0 ? (current / duration) * 100 : 0;
    const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;
    const chromeVisible = controlsVisible || keepControls;
    const btn = compact ? 'w-4 h-4' : 'w-[18px] h-[18px]';

    return (
        <div
            ref={shellRef}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onMouseMove={nudgeControls}
            onMouseLeave={() => { if (!keepControls) setControlsVisible(false); }}
            onDoubleClick={toggleFullscreen}
            className={`force-dark-controls group/player relative rounded-2xl overflow-hidden bg-black border border-white/10 select-none outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${fullscreen ? 'rounded-none flex items-center justify-center' : ''} ${className}`}
            style={{ cursor: chromeVisible ? 'default' : 'none' }}
        >
            <video
                key={reloadKey}
                ref={videoRef}
                src={fullVideoUrl}
                poster={poster ?? undefined}
                autoPlay={autoPlay}
                loop={loop}
                playsInline
                preload="metadata"
                controls={false}
                className="w-full h-full object-contain bg-black"
                onClick={togglePlay}
                onPlay={() => { setIsPlaying(true); setEnded(false); nudgeControls(); }}
                onPause={() => setIsPlaying(false)}
                onEnded={() => { setIsPlaying(false); setEnded(true); setControlsVisible(true); }}
                onWaiting={() => setWaiting(true)}
                onPlaying={() => { setWaiting(false); setErrored(false); }}
                onCanPlay={() => setWaiting(false)}
                onError={() => { setErrored(true); setWaiting(false); }}
                onTimeUpdate={(e) => { if (!scrubbing) setCurrent(e.currentTarget.currentTime); }}
                onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
                onLoadedMetadata={(e) => {
                    setDuration(e.currentTarget.duration || 0);
                    setVolume(e.currentTarget.volume);
                    setMuted(e.currentTarget.muted);
                }}
                onProgress={(e) => {
                    const v = e.currentTarget;
                    if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
                }}
                onRateChange={(e) => setRate(e.currentTarget.playbackRate)}
                onVolumeChange={(e) => {
                    setVolume(e.currentTarget.volume);
                    setMuted(e.currentTarget.muted);
                }}
            />

            {/* Title — fades in with the chrome */}
            {title && !compact && (
                <div
                    className={`pointer-events-none absolute top-0 left-0 right-0 z-20 px-4 pt-3 pb-8 bg-linear-to-b from-black/70 to-transparent transition-opacity duration-200 ${chromeVisible ? 'opacity-100' : 'opacity-0'}`}
                >
                    <p className="text-xs font-medium text-white/85 truncate">{title}</p>
                </div>
            )}

            {/* Buffering spinner */}
            {waiting && !errored && (
                <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
                    <Loader2 className="w-10 h-10 text-white/80 animate-spin drop-shadow-lg" />
                </div>
            )}

            {/* Transient feedback pill (seek / volume / speed) */}
            {toast && (
                <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
                    <span className="px-3 py-1.5 rounded-lg bg-black/70 backdrop-blur-md text-sm font-semibold text-white/95 ring-1 ring-white/15">
                        {toast}
                    </span>
                </div>
            )}

            {/* Center play / replay affordance */}
            {!isPlaying && !waiting && !errored && (
                <button
                    onClick={togglePlay}
                    aria-label={ended ? 'Replay video' : 'Play video'}
                    className="absolute inset-0 z-20 flex items-center justify-center bg-black/15 hover:bg-black/25 transition-colors"
                >
                    <span className={`${compact ? 'w-12 h-12' : 'w-[68px] h-[68px]'} rounded-full bg-white/92 flex items-center justify-center shadow-[0_10px_36px_-8px_rgba(0,0,0,0.8)] ring-1 ring-white/50 scale-95 hover:scale-100 transition-transform duration-200`}>
                        {ended ? (
                            <RotateCcw className={compact ? 'w-5 h-5 text-black' : 'w-7 h-7 text-black'} />
                        ) : (
                            <Play className={compact ? 'w-5 h-5 text-black ml-0.5' : 'w-7 h-7 text-black ml-1'} fill="currentColor" />
                        )}
                    </span>
                </button>
            )}

            {/* Load failure */}
            {errored && (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center">
                    <AlertTriangle className="w-8 h-8 text-amber-300" />
                    <p className="text-sm text-white/85">This video failed to load.</p>
                    <button
                        onClick={() => { setErrored(false); setReloadKey((k) => k + 1); }}
                        className="flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-white/90 hover:bg-white/15 transition-colors"
                    >
                        <RefreshCcw className="w-3.5 h-3.5" />
                        Try again
                    </button>
                </div>
            )}

            {/* ---------------- Control bar ---------------- */}
            <div
                onClick={(e) => e.stopPropagation()}
                className={`absolute bottom-0 left-0 right-0 z-30 px-3 pb-2.5 pt-10 bg-linear-to-t from-black/85 via-black/45 to-transparent transition-[opacity,transform] duration-200 ${chromeVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}`}
            >
                {/* Scrubber */}
                <div
                    ref={trackRef}
                    role="slider"
                    aria-label="Seek"
                    aria-valuemin={0}
                    aria-valuemax={Math.round(duration)}
                    aria-valuenow={Math.round(current)}
                    aria-valuetext={`${formatTime(current)} of ${formatTime(duration)}`}
                    tabIndex={-1}
                    onPointerDown={onTrackPointerDown}
                    onPointerMove={onTrackPointerMove}
                    onPointerUp={endScrub}
                    onPointerCancel={endScrub}
                    onPointerLeave={() => { if (!scrubbing) setHoverRatio(null); }}
                    className="relative h-4 flex items-center cursor-pointer touch-none group/track"
                >
                    {/* Hovered timestamp */}
                    {hoverRatio !== null && duration > 0 && (
                        <span
                            className="pointer-events-none absolute -top-7 -translate-x-1/2 px-1.5 py-0.5 rounded-md bg-black/85 text-[10px] font-medium text-white/90 ring-1 ring-white/15 tabular-nums"
                            style={{ left: `${hoverRatio * 100}%` }}
                        >
                            {formatTime(hoverRatio * duration)}
                        </span>
                    )}
                    <div className="relative w-full h-1 rounded-full bg-white/15 overflow-visible transition-[height] duration-150 group-hover/track:h-1.5">
                        <div className="absolute inset-y-0 left-0 rounded-full bg-white/40" style={{ width: `${bufferedPct}%` }} />
                        <div className="absolute inset-y-0 left-0 rounded-full bg-white" style={{ width: `${progress}%` }} />
                        <span
                            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white shadow-[0_1px_6px_rgba(0,0,0,0.7)] transition-[width,height,opacity] duration-150 ${scrubbing ? 'w-3.5 h-3.5 opacity-100' : 'w-3 h-3 opacity-0 group-hover/track:opacity-100'}`}
                            style={{ left: `${progress}%` }}
                        />
                    </div>
                </div>

                {/* Buttons */}
                <div className="mt-1 flex items-center gap-1.5">
                    <button onClick={togglePlay} title={isPlaying ? 'Pause (k)' : 'Play (k)'} aria-label={isPlaying ? 'Pause' : 'Play'} className="p-1.5 rounded-md text-white/90 hover:text-white hover:bg-white/10 transition-colors">
                        {isPlaying ? <Pause className={btn} fill="currentColor" /> : <Play className={btn} fill="currentColor" />}
                    </button>

                    {!compact && (
                        <>
                            <button onClick={() => skip(-10)} title="Back 10s (j)" aria-label="Back 10 seconds" className="p-1.5 rounded-md text-white/75 hover:text-white hover:bg-white/10 transition-colors">
                                <RotateCcw className={btn} />
                            </button>
                            <button onClick={() => skip(10)} title="Forward 10s (l)" aria-label="Forward 10 seconds" className="p-1.5 rounded-md text-white/75 hover:text-white hover:bg-white/10 transition-colors">
                                <RotateCw className={btn} />
                            </button>
                        </>
                    )}

                    {/* Volume — slider slides open on hover/focus */}
                    <div className="flex items-center group/vol">
                        <button onClick={toggleMute} title={muted ? 'Unmute (m)' : 'Mute (m)'} aria-label={muted ? 'Unmute' : 'Mute'} className="p-1.5 rounded-md text-white/75 hover:text-white hover:bg-white/10 transition-colors">
                            {muted || volume === 0 ? <VolumeX className={btn} /> : volume < 0.5 ? <Volume1 className={btn} /> : <Volume2 className={btn} />}
                        </button>
                        {!compact && (
                            <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.01}
                                value={muted ? 0 : volume}
                                onChange={(e) => applyVolume(Number(e.target.value))}
                                aria-label="Volume"
                                className="vp-range w-0 opacity-0 group-hover/vol:w-16 group-hover/vol:opacity-100 focus:w-16 focus:opacity-100 transition-[width,opacity] duration-200"
                                style={{ ['--vp-fill' as string]: `${(muted ? 0 : volume) * 100}%` }}
                            />
                        )}
                    </div>

                    <span className="ml-1 text-[11px] font-medium text-white/70 tabular-nums">
                        {formatTime(current)}
                        <span className="text-white/35"> / {formatTime(duration)}</span>
                    </span>

                    <div className="flex-1" />

                    {!compact && (
                        <div ref={speedRef} className="relative">
                            <button
                                onClick={() => setSpeedOpen((o) => !o)}
                                title="Playback speed"
                                aria-label="Playback speed"
                                aria-expanded={speedOpen}
                                className={`flex items-center gap-1 px-1.5 py-1.5 rounded-md transition-colors hover:bg-white/10 ${rate !== 1 ? 'text-white' : 'text-white/75 hover:text-white'}`}
                            >
                                <Gauge className={btn} />
                                <span className="text-[11px] font-semibold tabular-nums">{rate}×</span>
                            </button>
                            {speedOpen && (
                                <div className="absolute bottom-full right-0 mb-2 w-24 rounded-lg border border-white/15 bg-black/90 backdrop-blur-md py-1 shadow-xl">
                                    {SPEEDS.map((s) => (
                                        <button
                                            key={s}
                                            onClick={() => applyRate(s)}
                                            className={`w-full px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-white/10 ${s === rate ? 'text-white font-semibold' : 'text-white/70'}`}
                                        >
                                            {s === 1 ? 'Normal' : `${s}×`}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {!compact && typeof document !== 'undefined' && document.pictureInPictureEnabled && (
                        <button onClick={() => void togglePip()} title="Picture in picture" aria-label="Picture in picture" className="p-1.5 rounded-md text-white/75 hover:text-white hover:bg-white/10 transition-colors">
                            <PictureInPicture2 className={btn} />
                        </button>
                    )}

                    <button onClick={toggleFullscreen} title={fullscreen ? 'Exit fullscreen (f)' : 'Fullscreen (f)'} aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} className="p-1.5 rounded-md text-white/75 hover:text-white hover:bg-white/10 transition-colors">
                        {fullscreen ? <Minimize2 className={btn} /> : <Maximize2 className={btn} />}
                    </button>
                </div>
            </div>
        </div>
    );
}
