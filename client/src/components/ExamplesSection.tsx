/**
 * ExamplesSection — landing page gallery of pre-recorded example videos.
 *
 * Cards are clickable; clicking opens a modal that plays the video instantly
 * (no backend render). All video URLs resolve to static files under
 * `client/public/examples/`.
 */

import { useState, useEffect } from 'react';
import { EXAMPLE_VIDEOS, type ExampleVideo } from '../data/examples';
import { Play, X, Clock } from 'lucide-react';

const CATEGORY_BADGE: Record<string, string> = {
    Mathematics: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    Physics: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
    Algorithms: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
};

function ExampleCard({ video, onPlay }: { video: ExampleVideo; onPlay: (v: ExampleVideo) => void }) {
    return (
        <button
            onClick={() => onPlay(video)}
            className="group relative text-left rounded-2xl overflow-hidden border border-primary-500/10 hover:border-primary-500/30 bg-navy-900/50 transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-primary-500/10"
        >
            {/* Thumbnail */}
            <div className={`relative aspect-video bg-linear-to-br ${video.gradient} flex items-center justify-center overflow-hidden`}>
                {/* Glyph anchor */}
                <span className="text-5xl font-bold text-white/80 drop-shadow-lg select-none">
                    {video.glyph}
                </span>

                {/* Play overlay */}
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
                    <div className="w-14 h-14 rounded-full bg-white/95 flex items-center justify-center shadow-2xl scale-90 group-hover:scale-100 transition-transform">
                        <Play className="w-6 h-6 text-navy-950 ml-0.5" fill="currentColor" />
                    </div>
                </div>

                {/* Duration badge */}
                <div className="absolute bottom-3 right-3 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[11px] text-white/90 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {video.duration}
                </div>
            </div>

            {/* Body */}
            <div className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                    <span
                        className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-md border ${CATEGORY_BADGE[video.category]}`}
                    >
                        {video.category}
                    </span>
                </div>
                <h3 className="text-base font-semibold text-slate-100 group-hover:text-primary-300 transition-colors">
                    {video.title}
                </h3>
                <p className="text-xs text-slate-500 line-clamp-2">
                    {video.description}
                </p>
            </div>
        </button>
    );
}

function VideoModal({ video, onClose }: { video: ExampleVideo; onClose: () => void }) {
    // Close on ESC.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 z-100 flex items-center justify-center px-4 py-8 bg-black/80 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="w-full max-w-4xl glass-card rounded-2xl overflow-hidden border border-primary-500/20"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-primary-500/10">
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
                        className="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-white/5 transition-colors shrink-0"
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

    return (
        <section id="examples" className="px-6 py-20 max-w-6xl mx-auto">
            <div className="text-center mb-12 space-y-3">
                <p className="text-[10px] uppercase tracking-widest text-primary-400 font-semibold">
                    See It In Action
                </p>
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
                    <span className="gradient-text">Example</span>{' '}
                    <span className="text-slate-300">Animations</span>
                </h2>
                <p className="text-slate-500 max-w-xl mx-auto">
                    Six pre-rendered videos across math, physics, and algorithms — click to play instantly.
                </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {EXAMPLE_VIDEOS.map((video) => (
                    <ExampleCard key={video.id} video={video} onPlay={setOpenVideo} />
                ))}
            </div>

            {openVideo && <VideoModal video={openVideo} onClose={() => setOpenVideo(null)} />}
        </section>
    );
}
