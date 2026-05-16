/**
 * ExamplesSection — landing page gallery of pre-recorded example videos.
 *
 * Each card uses the actual MP4's first frame as its thumbnail (no separate
 * poster image required). Hovering plays a muted, looping preview inline; click
 * opens a full-size modal with controls + audio.
 */

import { useState, useEffect, useRef } from 'react';
import { EXAMPLE_VIDEOS, type ExampleVideo } from '../data/examples';
import { Play, X, Clock } from 'lucide-react';

const CATEGORY_BADGE: Record<string, string> = {
    Mathematics: 'bg-blue-500/15 text-blue-200 border-blue-400/30',
    Physics: 'bg-purple-500/15 text-purple-200 border-purple-400/30',
    Algorithms: 'bg-emerald-500/15 text-emerald-200 border-emerald-400/30',
};

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/** Resolves an example to a concrete video URL. Returns null while loading or
 *  if the storyboard hasn't finished rendering (entry is then hidden). */
async function resolveExampleUrl(video: ExampleVideo): Promise<string | null> {
    if (video.videoUrl) return video.videoUrl;
    if (!video.storyboardId) return null;
    try {
        const res = await fetch(`${API_BASE}/api/public/storyboard/${video.storyboardId}`);
        if (!res.ok) return null;
        const data = await res.json();
        return data.finalVideoUrl ?? null;
    } catch {
        return null;
    }
}

function ExampleCard({ video, onPlay }: { video: ExampleVideo; onPlay: (v: ExampleVideo) => void }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [metadataLoaded, setMetadataLoaded] = useState(false);
    const [isHovered, setIsHovered] = useState(false);

    // Hover/focus → autoplay muted preview; leave → pause and reset to the
    // first frame so the next hover starts from the same poster shot.
    useEffect(() => {
        const v = videoRef.current;
        if (!v) return;
        if (isHovered) {
            v.play().catch(() => { /* autoplay can be denied; thumbnail stays */ });
        } else {
            v.pause();
            try { v.currentTime = 0; } catch { /* readyState too low — ignore */ }
        }
    }, [isHovered]);

    // Some browsers paint a black frame until currentTime nudges off zero.
    // Forcing a microscopic seek after metadata loads guarantees a real poster.
    const handleLoadedMetadata = () => {
        const v = videoRef.current;
        if (!v) return;
        try { v.currentTime = 0.05; } catch { /* ignore */ }
        setMetadataLoaded(true);
    };

    return (
        <button
            onClick={() => onPlay(video)}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onFocus={() => setIsHovered(true)}
            onBlur={() => setIsHovered(false)}
            className="group relative text-left rounded-2xl overflow-hidden border border-white/8 hover:border-white/25 bg-navy-900/40 transition-all duration-300 ease-out hover:-translate-y-1.5 hover:shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 active:scale-[0.99]"
        >
            {/* Thumbnail */}
            <div className="relative aspect-video overflow-hidden bg-black">
                {/* Gradient placeholder — shown until the first frame paints */}
                <div
                    className={`absolute inset-0 bg-linear-to-br ${video.gradient} flex items-center justify-center transition-opacity duration-500 ${metadataLoaded ? 'opacity-0' : 'opacity-100'
                        }`}
                >
                    <span className="text-4xl font-bold text-white/40 select-none">
                        {video.glyph}
                    </span>
                </div>

                {/* Actual video — frame 0 acts as the poster; hover loops it */}
                <video
                    ref={videoRef}
                    src={video.videoUrl}
                    muted
                    playsInline
                    loop
                    preload="metadata"
                    onLoadedMetadata={handleLoadedMetadata}
                    aria-hidden="true"
                    className={`absolute inset-0 w-full h-full object-cover transition-[opacity,transform] duration-700 ${metadataLoaded ? 'opacity-100' : 'opacity-0'
                        } group-hover:scale-[1.04]`}
                />

                {/* Glossy diagonal sheen — always-on subtle gloss */}
                <div className="pointer-events-none absolute inset-0 bg-linear-to-br from-white/12 via-transparent to-transparent mix-blend-overlay" />

                {/* Light-pass sweep on hover — single diagonal highlight that
                    slides across the card. Pure CSS, no JS. */}
                <div className="pointer-events-none absolute inset-0 overflow-hidden">
                    <div className="absolute -inset-y-1/2 -left-1/2 w-1/3 rotate-20 bg-linear-to-r from-transparent via-white/25 to-transparent -translate-x-full group-hover:translate-x-[450%] transition-transform duration-1400 ease-out" />
                </div>

                {/* Bottom darkening so the duration pill stays legible */}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-black/75 via-black/20 to-transparent" />

                {/* Play CTA */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <div className="w-14 h-14 rounded-full bg-white/95 flex items-center justify-center shadow-[0_8px_24px_-4px_rgba(0,0,0,0.6)] scale-75 group-hover:scale-100 transition-transform duration-300 ease-out ring-1 ring-white/40">
                        <Play className="w-6 h-6 text-black ml-0.5" fill="currentColor" />
                    </div>
                </div>

                {/* Category chip — top-left, glassy */}
                <span
                    className={`absolute top-3 left-3 text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-md border backdrop-blur-md ${CATEGORY_BADGE[video.category]}`}
                >
                    {video.category}
                </span>

                {/* Duration pill — bottom-right */}
                <div className="absolute bottom-3 right-3 px-2 py-0.5 rounded-md bg-black/70 backdrop-blur-md text-[11px] text-white/90 flex items-center gap-1 ring-1 ring-white/15">
                    <Clock className="w-3 h-3" />
                    {video.duration}
                </div>
            </div>

            {/* Body */}
            <div className="p-4 space-y-1.5">
                <h3 className="text-base font-semibold text-slate-100 group-hover:text-white transition-colors">
                    {video.title}
                </h3>
                <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                    {video.description}
                </p>
            </div>
        </button>
    );
}

function VideoModal({ video, onClose }: { video: ExampleVideo; onClose: () => void }) {
    const [mounted, setMounted] = useState(false);

    // Close on ESC + trigger enter animation on mount.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handler);
        // Next-frame mount so the transition runs.
        const id = requestAnimationFrame(() => setMounted(true));
        return () => {
            document.removeEventListener('keydown', handler);
            cancelAnimationFrame(id);
        };
    }, [onClose]);

    return (
        <div
            className={`fixed inset-0 z-100 flex items-center justify-center px-4 py-8 bg-black/85 backdrop-blur-md transition-opacity duration-300 ${mounted ? 'opacity-100' : 'opacity-0'
                }`}
            onClick={onClose}
        >
            <div
                className={`w-full max-w-4xl glass-card rounded-2xl overflow-hidden border border-white/15 transition-all duration-300 ease-out ${mounted ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
                    }`}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-white/8">
                    <div className="min-w-0 flex-1">
                        <span
                            className={`inline-block text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-md border ${CATEGORY_BADGE[video.category]}`}
                        >
                            {video.category}
                        </span>
                        <h3 className="text-lg font-bold text-slate-100 mt-1 truncate">
                            {video.title}
                        </h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-white/8 transition-colors shrink-0"
                        title="Close (Esc)"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Video */}
                <div className="aspect-video bg-black">
                    <video
                        key={video.id}
                        src={video.videoUrl}
                        poster={video.posterUrl}
                        controls
                        autoPlay
                        className="w-full h-full"
                    >
                        Your browser does not support the video tag.
                    </video>
                </div>

                {/* Description */}
                <div className="p-5">
                    <p className="text-sm text-slate-400">{video.description}</p>
                </div>
            </div>
        </div>
    );
}

export function ExamplesSection() {
    const [openVideo, setOpenVideo] = useState<ExampleVideo | null>(null);
    // Map of example.id → resolved video URL. Examples without a resolved URL
    // are hidden from the grid (e.g. storyboard hasn't finished rendering yet).
    const [resolvedUrls, setResolvedUrls] = useState<Record<string, string>>({});

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const entries = await Promise.all(
                EXAMPLE_VIDEOS.map(async (v) => [v.id, await resolveExampleUrl(v)] as const)
            );
            if (cancelled) return;
            const map: Record<string, string> = {};
            for (const [id, url] of entries) {
                if (url) map[id] = url;
            }
            setResolvedUrls(map);
        })();
        return () => { cancelled = true; };
    }, []);

    // Only render examples whose video URL has been resolved.
    const visibleExamples = EXAMPLE_VIDEOS
        .filter((v) => resolvedUrls[v.id])
        .map((v) => ({ ...v, videoUrl: resolvedUrls[v.id] }));

    return (
        <section id="examples" className="relative px-6 py-14 max-w-6xl mx-auto">
            {/* Section glow — subtle radial behind the grid */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(255,255,255,0.04),transparent_70%)]" />

            <div className="relative text-center mb-12 space-y-3">
                <p className="text-[10px] uppercase tracking-widest text-primary-400 font-semibold">
                    See It In Action
                </p>
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
                    <span className="gradient-text">Example</span>{' '}
                    <span className="text-slate-300">Animations</span>
                </h2>
                <p className="text-slate-500 max-w-xl mx-auto">
                    Six pre-rendered videos across math, physics, and algorithms — hover to preview, click to play with audio.
                </p>
            </div>

            <div className="relative grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {visibleExamples.map((video) => (
                    <ExampleCard key={video.id} video={video} onPlay={setOpenVideo} />
                ))}
            </div>

            {openVideo && <VideoModal video={openVideo} onClose={() => setOpenVideo(null)} />}
        </section>
    );
}
