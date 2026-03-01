/**
 * HeroSection — full-viewport hero with animated gradient background,
 * headline, subtitle, and CTA button navigating to dashboard.
 */

import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Play, Sparkles } from 'lucide-react';

export function HeroSection() {
    const navigate = useNavigate();

    return (
        <section className="relative min-h-screen flex items-center justify-center hero-gradient overflow-hidden">
            {/* Animated background orbs */}
            <div className="absolute inset-0 mesh-gradient pointer-events-none" />
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary-500/5 rounded-full blur-3xl animate-float" />
            <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-amber-500/5 rounded-full blur-3xl animate-float" style={{ animationDelay: '3s' }} />

            {/* Content */}
            <div className="relative z-10 max-w-4xl mx-auto px-6 text-center">
                {/* Badge */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-500/10 border border-primary-500/20 text-primary-300 text-xs font-medium mb-8"
                >
                    <Sparkles className="w-3.5 h-3.5" />
                    AI-Powered Video Generation
                </motion.div>

                {/* Headline */}
                <motion.h1
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: 0.1 }}
                    className="text-5xl md:text-7xl font-extrabold tracking-tight leading-tight mb-6"
                >
                    <span className="gradient-text">Transform Ideas</span>
                    <br />
                    <span className="text-slate-200">into Animated Videos</span>
                </motion.h1>

                {/* Subtitle */}
                <motion.p
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                    className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed"
                >
                    Describe any concept and watch it come alive as a narrated 2D animation &mdash;
                    powered by AI storyboarding, Manim rendering, and voice synthesis.
                </motion.p>

                {/* CTA buttons */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.3 }}
                    className="flex flex-col sm:flex-row items-center justify-center gap-4"
                >
                    <button
                        onClick={() => navigate('/dashboard')}
                        className="btn-primary flex items-center gap-2 text-base px-8 py-3.5"
                    >
                        <Play className="w-5 h-5" />
                        Start Creating
                    </button>
                    <a
                        href="#features"
                        className="btn-secondary flex items-center gap-2 text-base"
                    >
                        Learn More
                    </a>
                </motion.div>

                {/* Stats */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.6, delay: 0.5 }}
                    className="mt-16 flex items-center justify-center gap-8 md:gap-12"
                >
                    {[
                        { value: 'AI', label: 'Storyboard Gen' },
                        { value: '2D', label: 'Manim Animations' },
                        { value: 'TTS', label: 'Voice Narration' },
                    ].map((stat) => (
                        <div key={stat.label} className="text-center">
                            <p className="text-2xl font-bold gradient-text-cyan">{stat.value}</p>
                            <p className="text-xs text-slate-500 mt-1">{stat.label}</p>
                        </div>
                    ))}
                </motion.div>
            </div>

            {/* Bottom fade */}
            <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-navy-950 to-transparent pointer-events-none" />
        </section>
    );
}
