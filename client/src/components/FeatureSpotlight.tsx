/**
 * FeatureSpotlight — large two-card spotlight in the doubtflix style.
 * Follows the FeaturesSection in the landing flow. Each card has a sizable
 * mockup preview above a title + description block.
 */

import { motion } from 'framer-motion';
import { Play } from 'lucide-react';
import { EXAMPLE_VIDEOS } from '../data/examples';

// Static illustration served from client/public — drop the file at
// client/public/server-stack.png. The component falls back gracefully if
// the file is missing (browser shows the alt text).
const SERVER_STACK_IMG = '/server-stack.png';

export function FeatureSpotlight() {
    return (
        <section id="spotlight" className="relative py-16 px-6 overflow-hidden">
            <div className="max-w-6xl mx-auto">
                {/* Headline */}
                <motion.h2
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '-80px' }}
                    transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    className="text-center text-[clamp(1.75rem,5vw,3.75rem)] font-bold tracking-[-0.03em] leading-[1.05] text-slate-100 mb-3"
                >
                    AI Video Animation Engine
                </motion.h2>

                {/* Italic subtitle */}
                <motion.p
                    initial={{ opacity: 0, y: 12 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '-80px' }}
                    transition={{ duration: 0.5, delay: 0.1 }}
                    className="text-center italic text-base md:text-lg text-slate-400 max-w-2xl mx-auto mb-14"
                >
                    More than text answers — turn any concept into a visual story you can watch.
                </motion.p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <SpotlightCard
                        title="Prompt to playable video in minutes"
                        description="Type your topic, review the storyboard, hit render. The pipeline plans the scenes, writes the Manim code, generates the narration, and stitches everything into a single downloadable mp4."
                        preview={<DashboardPreview />}
                        delay={0}
                    />
                    <SpotlightCard
                        title="Built on real animation tools, not slides"
                        description="Manim — the same Python engine 3Blue1Brown uses — drives the visuals. Gemini plans and writes the code, Piper TTS voices it locally. The output is a real animation, not a deck."
                        preview={<StackIllustration />}
                        delay={0.1}
                    />
                </div>
            </div>
        </section>
    );
}

// ============================================================
// CARD WRAPPER
// ============================================================

function SpotlightCard({
    title,
    description,
    preview,
    delay,
}: {
    title: string;
    description: string;
    preview: React.ReactNode;
    delay: number;
}) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
            className="relative rounded-3xl border border-white/8 bg-white/3 backdrop-blur-md p-6 md:p-8 flex flex-col gap-6 hover:border-white/15 transition-colors"
        >
            <div className="rounded-2xl overflow-hidden bg-navy-950/60 border border-white/8 aspect-4/3 flex items-center justify-center">
                {preview}
            </div>
            <div>
                <h3 className="text-xl md:text-2xl font-semibold text-slate-100 leading-snug mb-3">
                    {title}
                </h3>
                <p className="text-sm md:text-base text-slate-400 leading-relaxed">
                    {description}
                </p>
            </div>
        </motion.div>
    );
}

// ============================================================
// LEFT CARD: dashboard mockup with video tiles + faux input
// ============================================================

function DashboardPreview() {
    const tiles = EXAMPLE_VIDEOS.slice(0, 6);
    return (
        <div className="relative w-full h-full p-4 flex flex-col">
            {/* Faux titlebar */}
            <div className="flex items-center gap-1.5 mb-3">
                <span className="w-2 h-2 rounded-full bg-white/15" />
                <span className="w-2 h-2 rounded-full bg-white/15" />
                <span className="w-2 h-2 rounded-full bg-white/15" />
                <span className="ml-2 text-[10px] text-slate-500 uppercase tracking-widest">
                    Dashboard
                </span>
            </div>

            {/* 3x2 grid of video tiles */}
            <div className="grid grid-cols-3 gap-2 flex-1">
                {tiles.map((v) => (
                    <div
                        key={v.id}
                        className={`relative rounded-md overflow-hidden border border-white/8 bg-linear-to-br ${v.gradient} flex items-center justify-center`}
                    >
                        <video
                            src={v.videoUrl}
                            muted
                            playsInline
                            preload="metadata"
                            aria-hidden="true"
                            className="absolute inset-0 w-full h-full object-cover opacity-90"
                        />
                        <div className="relative w-5 h-5 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center ring-1 ring-white/20">
                            <Play className="w-2.5 h-2.5 text-white ml-0.5" fill="currentColor" />
                        </div>
                    </div>
                ))}
            </div>

            {/* Faux prompt bar */}
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-white/10 bg-white/4 px-3 py-2">
                <span className="text-xs text-slate-500 flex-1 truncate">
                    Explain Newton's Law…
                </span>
                <span className="text-[10px] px-2 py-1 rounded-md bg-white text-black font-medium">
                    Generate Video
                </span>
            </div>
        </div>
    );
}

// ============================================================
// RIGHT CARD: stack illustration of the pipeline
// ============================================================

function StackIllustration() {
    return (
        <div className="relative w-full h-full flex items-center justify-center p-6">
            {/* Soft radial halo behind the illustration */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_55%_45%_at_50%_50%,rgba(255,255,255,0.06),transparent_70%)] pointer-events-none" />
            <motion.img
                src={SERVER_STACK_IMG}
                alt="Server stack with cloud and laptop nodes — the rendering pipeline"
                initial={{ opacity: 0, scale: 0.96 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="relative max-w-full max-h-full object-contain drop-shadow-[0_12px_30px_rgba(0,0,0,0.5)]"
            />
        </div>
    );
}
