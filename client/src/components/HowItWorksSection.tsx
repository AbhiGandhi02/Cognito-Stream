/**
 * HowItWorksSection — 3-step visual walkthrough of the platform workflow.
 */

import { motion } from 'framer-motion';
import { MessageSquare, Cpu, Video } from 'lucide-react';

const steps = [
    {
        number: '01',
        icon: MessageSquare,
        title: 'Describe Your Idea',
        description: 'Type a text prompt describing the educational topic, concept, or story you want animated.',
        color: 'from-primary-400 to-primary-500',
    },
    {
        number: '02',
        icon: Cpu,
        title: 'AI Generates Scenes',
        description: 'Gemini AI creates a multi-scene storyboard with narration, visuals, and Manim animation code.',
        color: 'from-amber-400 to-amber-500',
    },
    {
        number: '03',
        icon: Video,
        title: 'Download Your Video',
        description: 'Scenes are rendered, narrated with AI voice, assembled, and ready to download as a polished video.',
        color: 'from-emerald-400 to-emerald-500',
    },
];

export function HowItWorksSection() {
    return (
        <section id="how-it-works" className="relative py-24 px-6">
            <div className="max-w-5xl mx-auto">
                {/* Heading */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '-80px' }}
                    transition={{ duration: 0.5 }}
                    className="text-center mb-20"
                >
                    <h2 className="text-3xl md:text-5xl font-bold mb-4">
                        <span className="text-slate-200">How It</span>{' '}
                        <span className="gradient-text">Works</span>
                    </h2>
                    <p className="text-lg text-slate-400 max-w-xl mx-auto">
                        From idea to finished video in three simple steps.
                    </p>
                </motion.div>

                {/* Steps */}
                <div className="relative">
                    {/* Connecting line */}
                    <div className="hidden md:block absolute left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-primary-500/30 via-amber-500/30 to-emerald-500/30 -translate-x-1/2" />

                    <div className="space-y-16 md:space-y-24">
                        {steps.map((step, i) => (
                            <motion.div
                                key={step.number}
                                initial={{ opacity: 0, x: i % 2 === 0 ? -40 : 40 }}
                                whileInView={{ opacity: 1, x: 0 }}
                                viewport={{ once: true, margin: '-60px' }}
                                transition={{ duration: 0.5, delay: 0.1 }}
                                className={`relative flex items-center gap-8 md:gap-16 ${i % 2 === 0 ? 'md:flex-row' : 'md:flex-row-reverse'
                                    } flex-col`}
                            >
                                {/* Text */}
                                <div className={`flex-1 ${i % 2 === 0 ? 'md:text-right' : 'md:text-left'} text-center`}>
                                    <span className="text-xs font-mono text-primary-400/60 uppercase tracking-widest mb-2 block">
                                        Step {step.number}
                                    </span>
                                    <h3 className="text-2xl font-bold text-slate-100 mb-3">
                                        {step.title}
                                    </h3>
                                    <p className="text-sm text-slate-400 leading-relaxed max-w-sm mx-auto md:mx-0">
                                        {step.description}
                                    </p>
                                </div>

                                {/* Center icon */}
                                <div className="relative z-10 shrink-0">
                                    <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${step.color} flex items-center justify-center shadow-xl`}>
                                        <step.icon className="w-7 h-7 text-white" />
                                    </div>
                                </div>

                                {/* Spacer for alternating layout */}
                                <div className="flex-1 hidden md:block" />
                            </motion.div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}
