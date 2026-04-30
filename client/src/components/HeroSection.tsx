/**
 * HeroSection — minimal hero. Soft cyan glow at top, centered content,
 * one accent on the headline, three small stats. No floating blobs,
 * no mesh, no glassmorphism.
 */

import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

export function HeroSection() {
    const navigate = useNavigate();

    return (
        <section className="relative min-h-screen flex items-center justify-center hero-gradient overflow-hidden">
            <div className="relative z-10 max-w-3xl mx-auto px-6 text-center">
                {/* Badge */}
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                    className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/10 bg-white/2 text-xs text-slate-400 mb-10"
                >
                    <span className="w-1.5 h-1.5 rounded-full bg-primary-400" />
                    AI-powered animation
                </motion.div>

                {/* Headline */}
                <motion.h1
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.05 }}
                    className="text-5xl md:text-6xl font-semibold tracking-tight leading-[1.05] mb-5 text-slate-100"
                >
                    Turn ideas into{' '}
                    <span className="gradient-text">narrated animations</span>
                </motion.h1>

                {/* Subtitle */}
                <motion.p
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.15 }}
                    className="text-base md:text-lg text-slate-500 max-w-xl mx-auto mb-10 leading-relaxed"
                >
                    Describe any concept. Get back a 2D Manim animation with AI-generated narration.
                </motion.p>

                {/* CTAs */}
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.25 }}
                    className="flex flex-col sm:flex-row items-center justify-center gap-3"
                >
                    <button
                        onClick={() => navigate('/dashboard')}
                        className="btn-primary flex items-center gap-2 text-sm"
                    >
                        Start creating
                        <ArrowRight className="w-4 h-4" />
                    </button>
                    <a href="#examples" className="btn-secondary text-sm">
                        See examples
                    </a>
                </motion.div>

                {/* Stats — quieter, single row */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.5, delay: 0.4 }}
                    className="mt-20 flex items-center justify-center gap-10 md:gap-16 text-left"
                >
                    {[
                        { label: 'Storyboard', detail: 'AI-planned scenes' },
                        { label: 'Manim', detail: '2D animations' },
                        { label: 'Voice', detail: 'TTS narration' },
                    ].map((stat) => (
                        <div key={stat.label}>
                            <p className="text-sm font-medium text-slate-200">{stat.label}</p>
                            <p className="text-xs text-slate-500 mt-0.5">{stat.detail}</p>
                        </div>
                    ))}
                </motion.div>
            </div>

            {/* Bottom fade into next section */}
            <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-navy-950 to-transparent pointer-events-none" />
        </section>
    );
}
