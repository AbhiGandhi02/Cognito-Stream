/**
 * ComingSoonPage — placeholder shown for pages we haven't built yet
 * (Privacy Policy, Terms of Service, Acceptable Use). Renders with the
 * site nav + footer for continuity, plus a big centered "Coming soon"
 * block that names the requested page.
 */

import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Clock } from 'lucide-react';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';

export function ComingSoonPage({ title }: { title: string }) {
    return (
        <div className="min-h-screen bg-navy-950 text-slate-100 flex flex-col">
            <Navbar />
            <main className="flex-1 flex items-center justify-center px-6 pt-32 pb-20">
                <div className="text-center max-w-xl mx-auto">
                    <motion.div
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                        className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-white/10 bg-white/4 text-xs text-slate-300 mb-8 backdrop-blur-sm"
                    >
                        <Clock className="w-3.5 h-3.5" />
                        {title}
                    </motion.div>

                    <motion.h1
                        initial={{ opacity: 0, y: 24 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
                        className="text-[clamp(2.25rem,6.5vw,5rem)] font-bold tracking-[-0.03em] leading-[1.05] mb-5"
                    >
                        Coming <span className="gradient-text">soon</span>
                    </motion.h1>

                    <motion.p
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.18 }}
                        className="text-base md:text-lg text-slate-500 mb-10 leading-relaxed"
                    >
                        We're still drafting this page. Check back later — or reach out if you need the details right now.
                    </motion.p>

                    <motion.div
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.32 }}
                    >
                        <Link
                            to="/"
                            className="btn-primary inline-flex items-center gap-2 text-sm"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Back to home
                        </Link>
                    </motion.div>
                </div>
            </main>
            <Footer />
        </div>
    );
}
