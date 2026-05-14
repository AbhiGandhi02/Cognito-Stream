/**
 * HowItWorksSection — doubtflix-style: pill badge, big centered headline,
 * three cards (each with a small mockup preview), and a decorative dashed
 * arc that ties them together.
 */

import { motion } from 'framer-motion';
import { ArrowUp, MousePointer2, Plus, Play } from 'lucide-react';
import { EXAMPLE_VIDEOS } from '../data/examples';

export function HowItWorksSection() {
    return (
        <section id="how-it-works" className="relative py-16 px-6 overflow-hidden">
            <div className="max-w-6xl mx-auto">
                {/* Pill badge */}
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '-80px' }}
                    transition={{ duration: 0.4 }}
                    className="flex justify-center mb-6"
                >
                    <span className="inline-flex items-center px-3.5 py-1.5 rounded-full border border-white/10 bg-white/4 text-xs text-slate-300 backdrop-blur-sm">
                        How it works
                    </span>
                </motion.div>

                {/* Headline */}
                <motion.h2
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '-80px' }}
                    transition={{ duration: 0.6, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
                    className="text-center text-[clamp(1.75rem,4.5vw,3.5rem)] font-bold tracking-[-0.03em] leading-[1.05] text-slate-100 mb-4"
                >
                    Three steps from prompt to video
                </motion.h2>

                {/* Subtitle */}
                <motion.p
                    initial={{ opacity: 0, y: 16 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '-80px' }}
                    transition={{ duration: 0.5, delay: 0.15 }}
                    className="text-center text-sm md:text-base text-slate-500 max-w-xl mx-auto"
                >
                    From your prompt to a narrated 2D animation in minutes.
                </motion.p>

                {/* "It's this simple." cursive caption + decorative arc */}
                <div className="relative h-24 mt-6 mb-2">
                    <motion.p
                        initial={{ opacity: 0, rotate: -6 }}
                        whileInView={{ opacity: 1, rotate: -6 }}
                        viewport={{ once: true, margin: '-80px' }}
                        transition={{ duration: 0.5, delay: 0.3 }}
                        className="absolute right-1/4 top-2 text-base italic font-medium text-slate-400 select-none pointer-events-none"
                    >
                        It's this simple.
                    </motion.p>

                    {/* Dashed curving arc connecting the steps */}
                    <DecorativeArc />
                </div>

                {/* Three step cards */}
                <div className="relative grid grid-cols-1 md:grid-cols-3 gap-6">
                    <StepCard
                        title="Describe your idea"
                        description="Type a prompt for the topic you want animated. The system breaks it into scenes."
                        preview={<PromptPreview />}
                        delay={0}
                    />
                    <StepCard
                        title="AI builds the scenes"
                        description="Storyboard, Manim code, and TTS narration are generated and stitched into a single mp4."
                        preview={<GeneratePreview />}
                        delay={0.1}
                    />
                    <StepCard
                        title="Watch and share"
                        description="Preview the final video, download it, or browse it later from your dashboard history."
                        preview={<VideoGridPreview />}
                        delay={0.2}
                    />
                </div>
            </div>
        </section>
    );
}

// ============================================================
// STEP CARD
// ============================================================

function StepCard({
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
            transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
            className="relative rounded-2xl border border-white/8 bg-white/3 backdrop-blur-md p-6 flex flex-col gap-5 hover:border-white/15 transition-colors min-h-[420px]"
        >
            <div>
                <h3 className="text-xl font-semibold text-slate-100 leading-snug mb-2">
                    {title}
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">{description}</p>
            </div>

            <div className="flex-1 flex items-center justify-center">
                <div className="w-full">{preview}</div>
            </div>
        </motion.div>
    );
}

// ============================================================
// MOCKUP PREVIEWS
// ============================================================

function PromptPreview() {
    return (
        <div className="rounded-xl border border-white/10 bg-navy-950/60 p-3.5 backdrop-blur-sm">
            <p className="text-sm text-slate-200 mb-3 leading-relaxed">
                Explain Permutation and Combination?
                <span className="inline-block w-px h-4 bg-slate-300 ml-0.5 align-middle animate-pulse" />
            </p>
            <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-white/10 bg-white/4 text-[11px] text-slate-300">
                    <Plus className="w-3 h-3" />
                    Upload
                </span>
                <button
                    type="button"
                    tabIndex={-1}   
                    aria-hidden="true"
                    className="w-7 h-7 rounded-md bg-white/8 border border-white/10 flex items-center justify-center text-slate-200"
                >
                    <ArrowUp className="w-3.5 h-3.5" />
                </button>
            </div>
        </div>
    );
}

function GeneratePreview() {
    return (
        <div className="relative rounded-xl border border-white/10 bg-navy-950/60 h-44 flex items-center justify-center">
            <div className="relative">
                <button
                    type="button"
                    tabIndex={-1}
                    aria-hidden="true"
                    className="px-5 py-2.5 rounded-full bg-white text-black text-sm font-medium shadow-[0_8px_24px_-4px_rgba(255,255,255,0.18)]"
                >
                    Render Final Video
                </button>
                {/* Floating cursor — drifts slightly to feel alive */}
                <motion.div
                    initial={{ y: -8, x: -6 }}
                    animate={{ y: [-8, -4, -8], x: [-6, -2, -6] }}
                    transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                    className="absolute -top-5 -left-3 text-slate-100"
                >
                    <MousePointer2 className="w-5 h-5" fill="currentColor" />
                </motion.div>
            </div>
        </div>
    );
}

function VideoGridPreview() {
    // Reuse the first four examples for visually authentic poster frames.
    const tiles = EXAMPLE_VIDEOS.slice(0, 4);
    return (
        <div className="grid grid-cols-2 gap-2.5">
            {tiles.map((v) => (
                <div
                    key={v.id}
                    className={`relative aspect-video rounded-lg overflow-hidden border border-white/8 bg-linear-to-br ${v.gradient} flex items-center justify-center`}
                >
                    <video
                        src={v.videoUrl}
                        muted
                        playsInline
                        preload="metadata"
                        aria-hidden="true"
                        className="absolute inset-0 w-full h-full object-cover opacity-90"
                    />
                    <div className="relative w-7 h-7 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center ring-1 ring-white/20">
                        <Play className="w-3 h-3 text-white ml-0.5" fill="currentColor" />
                    </div>
                </div>
            ))}
        </div>
    );
}

// ============================================================
// DECORATIVE ARC
// ============================================================

/** Dashed swooping arc with two endpoint dots — pure SVG, decorative only.
 *  Sits behind the step cards. preserveAspectRatio="none" lets the curve
 *  stretch to whatever width the section ends up at. */
function DecorativeArc() {
    return (
        <svg
            className="absolute inset-x-0 -bottom-4 w-full h-24 pointer-events-none"
            viewBox="0 0 1000 100"
            preserveAspectRatio="none"
            fill="none"
            aria-hidden="true"
        >
            <path
                d="M 120 90 Q 250 -20 500 60 T 880 30"
                stroke="rgba(255,255,255,0.28)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray="6 8"
                vectorEffect="non-scaling-stroke"
            />
            <circle cx="120" cy="90" r="5" fill="rgba(255,255,255,0.55)" />
            <circle cx="880" cy="30" r="5" fill="rgba(255,255,255,0.55)" />
        </svg>
    );
}
