/**
 * HeroSection — doubtflix-style centered hero with a prompt input.
 *
 * Layout: pill badge → oversized two-line headline → subtitle → prompt box
 * (textarea + chips + send) → "powered by" credits. On submit the prompt is
 * handed off to /dashboard via router state so the user lands with their
 * question already typed in.
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, Sparkles, Mic, Languages, Monitor } from 'lucide-react';

export function HeroSection() {
    const navigate = useNavigate();
    const [prompt, setPrompt] = useState('');

    const submit = () => {
        const trimmed = prompt.trim();
        navigate('/dashboard', trimmed ? { state: { initialPrompt: trimmed } } : undefined);
    };

    return (
        <section className="relative min-h-screen flex items-center justify-center hero-gradient overflow-hidden grain pt-24 pb-8">
            <div className="relative z-10 w-full max-w-3xl mx-auto px-6 text-center">
                {/* Badge */}
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                    className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-white/10 bg-white/4 text-xs text-slate-300 mb-8 backdrop-blur-sm"
                >
                    <Sparkles className="w-3.5 h-3.5 text-slate-300" />
                    AI-powered animation
                </motion.div>

                {/* Headline — medium scale */}
                <motion.h1
                    initial={{ opacity: 0, y: 28 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.7, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
                    className="text-[clamp(2.25rem,6.5vw,5rem)] font-bold tracking-[-0.03em] leading-[1.05] mb-5 text-slate-100"
                >
                    Turn ideas into
                    <br />
                    <span className="gradient-text">narrated animations</span>
                </motion.h1>

                {/* Subtitle */}
                <motion.p
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    className="text-base md:text-lg text-slate-500 max-w-xl mx-auto mb-9 leading-relaxed"
                >
                    Describe any concept. Get back a 2D Manim animation with AI-generated narration.
                </motion.p>

                {/* Prompt box — doubtflix-style: textarea + chip row + send button */}
                <motion.div
                    initial={{ opacity: 0, y: 20, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.6, delay: 0.32, ease: [0.22, 1, 0.36, 1] }}
                    className="relative max-w-3xl mx-auto rounded-2xl border border-white/10 bg-white/3 backdrop-blur-md p-4 text-left shadow-[0_10px_40px_-15px_rgba(0,0,0,0.4)] hover:border-white/15 transition-colors"
                >
                    <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                submit();
                            }
                        }}
                        rows={2}
                        placeholder="Ask a question (will generate video)…"
                        className="w-full resize-none bg-transparent text-slate-100 placeholder:text-slate-600 text-base focus:outline-none leading-relaxed"
                    />

                    {/* Bottom row — chips left, mic + send right */}
                    <div className="flex items-center justify-between gap-3 mt-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <HeroChip icon={<Sparkles className="w-3.5 h-3.5" />} label="Storyboard" />
                            <HeroChip icon={<Languages className="w-3.5 h-3.5" />} label="English" />
                            <HeroChip icon={<Monitor className="w-3.5 h-3.5" />} label="Landscape" />
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                            <button
                                type="button"
                                className="w-9 h-9 rounded-full flex items-center justify-center text-slate-500 hover:text-slate-200 hover:bg-white/8 transition-colors"
                                aria-label="Voice input (coming soon)"
                                disabled
                            >
                                <Mic className="w-4 h-4" />
                            </button>
                            <button
                                type="button"
                                onClick={submit}
                                aria-label="Generate video"
                                className="w-9 h-9 rounded-full flex items-center justify-center bg-white text-black hover:bg-white/90 transition-all shadow-[0_4px_14px_-2px_rgba(255,255,255,0.2)] hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-30"
                            >
                                <ArrowUp className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </motion.div>

                {/* Powered by */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.6, delay: 0.55 }}
                    className="mt-14 flex items-center justify-center gap-3 text-xs text-slate-500"
                >
                    <span>Powered by</span>
                    <span className="text-slate-300 font-medium">Manim</span>
                    <span className="text-slate-700">·</span>
                    <span className="text-slate-300 font-medium">Gemini</span>
                    <span className="text-slate-700">·</span>
                    <span className="text-slate-300 font-medium">Piper TTS</span>
                </motion.div>
            </div>

            {/* Bottom fade into next section */}
            <div className="absolute bottom-0 left-0 right-0 h-24 bg-linear-to-t from-navy-950 to-transparent pointer-events-none" />
        </section>
    );
}

function HeroChip({ icon, label }: { icon: React.ReactNode; label: string }) {
    return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/4 border border-white/8 text-[11px] text-slate-300">
            {icon}
            {label}
        </span>
    );
}
