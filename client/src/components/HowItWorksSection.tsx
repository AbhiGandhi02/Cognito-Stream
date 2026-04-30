/**
 * HowItWorksSection — minimal 3-step list. Vertical, left-aligned,
 * no zig-zag layout, no gradient icon tiles.
 */

import { motion } from 'framer-motion';

const steps = [
    {
        number: '01',
        title: 'Describe your idea',
        description: 'Type a prompt for the topic you want animated. The system breaks it into scenes.',
    },
    {
        number: '02',
        title: 'Review the plan',
        description: 'Inspect the generated narration and Manim code per scene. Tweak whatever feels off, then trigger the render.',
    },
    {
        number: '03',
        title: 'Get a finished video',
        description: 'Each scene renders with TTS narration, then assembles into a single mp4 you can download or share.',
    },
];

export function HowItWorksSection() {
    return (
        <section id="how-it-works" className="relative py-28 px-6">
            <div className="max-w-3xl mx-auto">
                {/* Heading */}
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '-80px' }}
                    transition={{ duration: 0.4 }}
                    className="mb-14"
                >
                    <p className="text-xs uppercase tracking-widest text-primary-400 font-medium mb-3">
                        How it works
                    </p>
                    <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-slate-100">
                        Three steps from prompt to video
                    </h2>
                </motion.div>

                {/* Steps */}
                <div className="space-y-10">
                    {steps.map((step, i) => (
                        <motion.div
                            key={step.number}
                            initial={{ opacity: 0, y: 16 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true, margin: '-40px' }}
                            transition={{ duration: 0.35, delay: i * 0.08 }}
                            className="flex gap-6"
                        >
                            <span className="shrink-0 text-sm font-mono text-primary-400/60 mt-0.5 tabular-nums">
                                {step.number}
                            </span>
                            <div className="space-y-1.5">
                                <h3 className="text-base font-medium text-slate-200">
                                    {step.title}
                                </h3>
                                <p className="text-sm text-slate-500 leading-relaxed">
                                    {step.description}
                                </p>
                            </div>
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    );
}
