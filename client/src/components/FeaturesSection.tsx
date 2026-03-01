/**
 * FeaturesSection — animated feature cards grid showcasing platform capabilities.
 * Cards animate in on scroll using framer-motion.
 */

import { motion } from 'framer-motion';
import {
    Brain,
    Mic,
    Film,
    PenTool,
    Download,
    Eye,
} from 'lucide-react';

const features = [
    {
        icon: Brain,
        title: 'AI Storyboard Generation',
        description: 'Gemini AI transforms your text prompts into structured, multi-scene storyboards with narration and visual details.',
        color: 'from-primary-400 to-primary-600',
        glow: 'primary',
    },
    {
        icon: Mic,
        title: 'Voice Narration',
        description: 'ElevenLabs text-to-speech generates natural, human-like voiceovers for every scene automatically.',
        color: 'from-amber-400 to-amber-600',
        glow: 'amber',
    },
    {
        icon: Film,
        title: '2D Manim Animations',
        description: 'Professional mathematical and educational animations rendered using the Manim engine in real-time.',
        color: 'from-emerald-400 to-emerald-600',
        glow: 'emerald',
    },
    {
        icon: PenTool,
        title: 'Scene-Level Editing',
        description: 'Edit narration, visual descriptions, and Manim code for each scene individually before rendering.',
        color: 'from-violet-400 to-violet-600',
        glow: 'violet',
    },
    {
        icon: Download,
        title: 'Auto Video Assembly',
        description: 'Scenes are automatically assembled into a final video with synced audio and smooth transitions.',
        color: 'from-rose-400 to-rose-600',
        glow: 'rose',
    },
    {
        icon: Eye,
        title: 'Real-Time Preview',
        description: 'Preview individual scenes and the final assembled video directly in the browser with custom controls.',
        color: 'from-sky-400 to-sky-600',
        glow: 'sky',
    },
];

const glowMap: Record<string, string> = {
    primary: 'rgba(6, 182, 212, 0.08)',
    amber: 'rgba(245, 158, 11, 0.08)',
    emerald: 'rgba(52, 211, 153, 0.08)',
    violet: 'rgba(139, 92, 246, 0.08)',
    rose: 'rgba(251, 113, 133, 0.08)',
    sky: 'rgba(56, 189, 248, 0.08)',
};

export function FeaturesSection() {
    return (
        <section id="features" className="relative py-24 px-6">
            <div className="max-w-6xl mx-auto">
                {/* Heading */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '-80px' }}
                    transition={{ duration: 0.5 }}
                    className="text-center mb-16"
                >
                    <h2 className="text-3xl md:text-5xl font-bold mb-4">
                        <span className="gradient-text">Powerful</span>{' '}
                        <span className="text-slate-200">Features</span>
                    </h2>
                    <p className="text-lg text-slate-400 max-w-2xl mx-auto">
                        Everything you need to turn a text prompt into a narrated, animated educational video.
                    </p>
                </motion.div>

                {/* Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {features.map((feature, i) => (
                        <motion.div
                            key={feature.title}
                            initial={{ opacity: 0, y: 30 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true, margin: '-60px' }}
                            transition={{ duration: 0.4, delay: i * 0.08 }}
                            className="glass-card rounded-2xl p-6 group cursor-default"
                            style={{
                                ['--hover-glow' as string]: glowMap[feature.glow],
                            }}
                        >
                            {/* Icon */}
                            <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${feature.color} flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                                <feature.icon className="w-6 h-6 text-white" />
                            </div>

                            {/* Text */}
                            <h3 className="text-lg font-semibold text-slate-100 mb-2">
                                {feature.title}
                            </h3>
                            <p className="text-sm text-slate-400 leading-relaxed">
                                {feature.description}
                            </p>
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    );
}
