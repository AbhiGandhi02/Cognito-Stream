/**
 * FeaturesSection — minimal grid of capabilities. Single accent color,
 * no gradient icon tiles, plain icons inline with the title.
 *
 * Updated to reflect actual current pipeline: AI storyboarding, Manim
 * rendering, Piper TTS narration, scene-level editing/iteration,
 * automatic assembly, and Gemini→Groq fallback.
 */

import { motion } from 'framer-motion';
import {
    Brain,
    Mic,
    Film,
    PenTool,
    Layers,
    Shuffle,
} from 'lucide-react';

const features = [
    {
        icon: Brain,
        title: 'AI storyboard generation',
        description: 'Your prompt becomes a multi-scene plan with narration and visual descriptions.',
    },
    {
        icon: Film,
        title: '2D Manim animations',
        description: 'Generated Python is executed in a sandboxed renderer with auto-correction on failure.',
    },
    {
        icon: Mic,
        title: 'Local voice narration',
        description: 'Piper TTS runs in-process — no external API key, no quota.',
    },
    {
        icon: PenTool,
        title: 'Review & iterate per scene',
        description: 'Inspect generated code, tweak narration, regenerate just the scene that’s off.',
    },
    {
        icon: Layers,
        title: 'Auto video assembly',
        description: 'Scene videos and audio are stitched into one final mp4 you can download.',
    },
    {
        icon: Shuffle,
        title: 'LLM fallback',
        description: 'Gemini first, Groq when quota or upstream issues hit. Renders never block on a single provider.',
    },
];

export function FeaturesSection() {
    return (
        <section id="features" className="relative py-16 px-6">
            <div className="max-w-5xl mx-auto">
                {/* Heading */}
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '-80px' }}
                    transition={{ duration: 0.4 }}
                    className="max-w-xl mb-16"
                >
                    <p className="text-xs uppercase tracking-widest text-primary-400 font-medium mb-3">
                        What it does
                    </p>
                    <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-slate-100">
                        Everything from prompt to playable video
                    </h2>
                </motion.div>

                {/* Grid — flat layout, no card surfaces */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {features.map((feature, i) => (
                        <motion.div
                            key={feature.title}
                            initial={{ opacity: 0, y: 16 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true, margin: '-40px' }}
                            transition={{ duration: 0.35, delay: i * 0.06 }}
                            className="rounded-2xl border border-white/8 bg-white/3 backdrop-blur-md p-6 space-y-3 hover:border-white/15 transition-colors"
                        >
                            <feature.icon className="w-5 h-5 text-primary-400" strokeWidth={1.75} />
                            <h3 className="text-sm font-medium text-slate-200">
                                {feature.title}
                            </h3>
                            <p className="text-sm text-slate-500 leading-relaxed">
                                {feature.description}
                            </p>
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    );
}
