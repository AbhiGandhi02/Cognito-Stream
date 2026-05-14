/**
 * ContactPage — contact + support page in the doubtflix style.
 * Layout: hero header → two contact-method cards → follow-us strip →
 * FAQ accordion (anchored at #faq) → "Meet the Team" cards → Footer.
 */

import { motion } from 'framer-motion';
import {
    Mail,
    Github,
    Instagram,
    Linkedin,
    ChevronDown,
    User,
} from 'lucide-react';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';

const SUPPORT_EMAIL = 'abhigandhi0212@gmail.com';

const faqs: { q: string; a: string }[] = [
    {
        q: 'What is Cognito Stream?',
        a: 'Cognito Stream turns a text prompt into a narrated 2D animation. The pipeline plans a multi-scene storyboard, writes Manim code per scene, generates the narration with Piper TTS, and stitches everything into a single mp4 you can download.',
    },
    {
        q: 'How much does it cost?',
        a: 'The project is currently free to use while in development. Heavy AI usage may be rate-limited on the free tier.',
    },
    {
        q: 'How long does generation take?',
        a: 'Typical end-to-end runtime is 2-6 minutes depending on scene count and Manim render complexity. Most short explanations finish in under three minutes.',
    },
    {
        q: 'What subjects are supported?',
        a: 'Math, physics, computer science, and any topic Manim can express visually. The LLM plans the scenes, so anything you can describe in words is a candidate — though abstract topics with strong visual analogies work best.',
    },
    {
        q: 'Can I edit the storyboard before rendering?',
        a: 'Yes. After the initial storyboard is generated you can inspect each scene, tweak narration, regenerate code, or skip the scene entirely before triggering the final render.',
    },
];

const INSTAGRAM_URL = 'https://instagram.com/abhi_gandhi02';
const INSTAGRAM_HANDLE = '@abhi_gandhi02';
const LINKEDIN_URL = 'https://www.linkedin.com/in/abhigandhi02/';

const team: { name: string; role: string; img?: string; links?: { kind: 'mail' | 'instagram' | 'linkedin'; href: string }[] }[] = [
    {
        name: 'Abhi Gandhi',
        role: 'Founder & Engineer',
        img: "/Abhi's%20Cognito.png",
        links: [
            { kind: 'mail', href: `mailto:${SUPPORT_EMAIL}` },
            { kind: 'linkedin', href: LINKEDIN_URL },
            { kind: 'instagram', href: INSTAGRAM_URL },
        ],
    },
];

export function ContactPage() {
    // Hash-anchor scrolling (e.g. /contact#faq) is handled by ScrollManager
    // in App.tsx so every route benefits from the same behavior.
    return (
        <div className="min-h-screen bg-navy-950 text-slate-100 flex flex-col">
            <Navbar />

            <main className="flex-1">
                {/* ============== HERO ============== */}
                <section className="px-6 pt-32 pb-12 text-center">
                    <motion.h1
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                        className="text-[clamp(2.25rem,6vw,4.5rem)] font-bold tracking-[-0.03em] leading-[1.05] mb-4"
                    >
                        Contact <span className="gradient-text">& Support</span>
                    </motion.h1>
                    <motion.p
                        initial={{ opacity: 0, y: 14 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.15 }}
                        className="text-base md:text-lg text-slate-500 max-w-xl mx-auto"
                    >
                        Have a question or need help? We're here for you.
                    </motion.p>
                </section>

                {/* ============== CONTACT CARDS ============== */}
                <section className="px-6 max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-5">
                    <ContactCard
                        icon={<Mail className="w-5 h-5" />}
                        title="Email us"
                        primary={SUPPORT_EMAIL}
                        secondary="We reply within 24 hours"
                        href={`mailto:${SUPPORT_EMAIL}`}
                    />
                    <ContactCard
                        icon={<Instagram className="w-5 h-5" />}
                        title="DM on Instagram"
                        primary={INSTAGRAM_HANDLE}
                        secondary="Quick responses for simple queries"
                        href={INSTAGRAM_URL}
                    />
                </section>

                {/* ============== FOLLOW US ============== */}
                <section className="px-6 max-w-5xl mx-auto mt-12">
                    <p className="text-xs uppercase tracking-widest text-slate-500 mb-3">
                        Follow us
                    </p>
                    <div className="flex items-center gap-3">
                        <SocialIcon href="https://github.com/AbhiGandhi02" aria="GitHub">
                            <Github className="w-4 h-4" />
                        </SocialIcon>
                        <SocialIcon href={LINKEDIN_URL} aria="LinkedIn">
                            <Linkedin className="w-4 h-4" />
                        </SocialIcon>
                        <SocialIcon href={INSTAGRAM_URL} aria="Instagram">
                            <Instagram className="w-4 h-4" />
                        </SocialIcon>
                    </div>
                </section>

                {/* ============== FAQ ============== */}
                <section id="faq" className="px-6 max-w-3xl mx-auto mt-20 scroll-mt-32">
                    <h2 className="text-2xl md:text-3xl font-bold tracking-[-0.02em] text-slate-100 mb-8">
                        Frequently Asked Questions
                    </h2>
                    <div className="space-y-3">
                        {faqs.map((item) => (
                            <FaqItem key={item.q} q={item.q} a={item.a} />
                        ))}
                    </div>
                </section>

                {/* ============== MEET THE TEAM ============== */}
                <section className="px-6 max-w-5xl mx-auto mt-24 text-center">
                    <motion.span
                        initial={{ opacity: 0, y: 8 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, margin: '-80px' }}
                        transition={{ duration: 0.4 }}
                        className="inline-flex items-center px-3.5 py-1.5 rounded-full border border-white/10 bg-white/4 text-xs text-slate-300 backdrop-blur-sm mb-5"
                    >
                        Our Team
                    </motion.span>
                    <motion.h2
                        initial={{ opacity: 0, y: 16 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, margin: '-80px' }}
                        transition={{ duration: 0.5, delay: 0.05 }}
                        className="text-[clamp(2rem,5vw,3.5rem)] font-bold tracking-[-0.03em] leading-[1.05] mb-3"
                    >
                        Meet the Team
                    </motion.h2>
                    <motion.p
                        initial={{ opacity: 0, y: 12 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, margin: '-80px' }}
                        transition={{ duration: 0.5, delay: 0.15 }}
                        className="italic text-base md:text-lg text-slate-400 mb-12 max-w-2xl mx-auto"
                    >
                        Passionate engineers building the future of self-paced learning.
                    </motion.p>

                    <div className="max-w-xs mx-auto text-left">
                        {team.map((m, i) => (
                            <TeamCard key={m.name} member={m} delay={i * 0.1} />
                        ))}
                    </div>
                </section>

                {/* ============== CONTRIBUTE CTA ============== */}
                <section className="px-6 max-w-3xl mx-auto mt-20 mb-24">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, margin: '-60px' }}
                        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                        className="relative rounded-3xl border border-white/10 bg-white/3 backdrop-blur-md p-8 md:p-10 text-center overflow-hidden"
                    >
                        {/* Soft halo */}
                        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(255,255,255,0.06),transparent_70%)]" />
                        <div className="relative">
                            <span className="inline-flex items-center px-3 py-1 rounded-full border border-white/10 bg-white/4 text-[11px] uppercase tracking-widest text-slate-300 mb-4">
                                Open to contributors
                            </span>
                            <h3 className="text-2xl md:text-3xl font-bold tracking-[-0.02em] text-slate-100 mb-3">
                                Want to help build this?
                            </h3>
                            <p className="text-sm md:text-base text-slate-400 leading-relaxed max-w-xl mx-auto mb-6">
                                Cognito Stream is a one-person project right now — there's plenty to ship, from the renderer to the LLM pipeline to the UI. If you'd like to contribute code, ideas, or feedback, get in touch.
                            </p>
                            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                                <a
                                    href={`mailto:${SUPPORT_EMAIL}?subject=Contributing%20to%20Cognito%20Stream`}
                                    className="btn-primary inline-flex items-center gap-2 text-sm"
                                >
                                    <Mail className="w-4 h-4" />
                                    Email me
                                </a>
                                <a
                                    href="https://github.com/AbhiGandhi02"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn-secondary inline-flex items-center gap-2 text-sm"
                                >
                                    <Github className="w-4 h-4" />
                                    GitHub
                                </a>
                            </div>
                        </div>
                    </motion.div>
                </section>
            </main>

            <Footer />
        </div>
    );
}

// ============================================================
// PIECES
// ============================================================

function ContactCard({
    icon,
    title,
    primary,
    secondary,
    href,
}: {
    icon: React.ReactNode;
    title: string;
    primary: string;
    secondary: string;
    href: string;
}) {
    const isExternal = /^https?:/.test(href);
    return (
        <a
            href={href}
            target={isExternal ? '_blank' : undefined}
            rel={isExternal ? 'noopener noreferrer' : undefined}
            className="group relative rounded-2xl border border-white/8 bg-white/3 backdrop-blur-md p-5 flex items-start gap-4 hover:border-white/20 hover:bg-white/5 transition-colors"
        >
            <div className="shrink-0 w-10 h-10 rounded-xl bg-white/8 border border-white/10 flex items-center justify-center text-slate-200">
                {icon}
            </div>
            <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-100">{title}</p>
                <p className="text-sm text-slate-300 mt-1 truncate group-hover:text-white transition-colors">
                    {primary}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">{secondary}</p>
            </div>
        </a>
    );
}

function SocialIcon({
    href,
    aria,
    children,
}: {
    href: string;
    aria: string;
    children: React.ReactNode;
}) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={aria}
            className="w-9 h-9 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-100 border border-white/8 hover:border-white/20 bg-white/2 hover:bg-white/6 transition-colors"
        >
            {children}
        </a>
    );
}

function FaqItem({ q, a }: { q: string; a: string }) {
    return (
        <details className="group rounded-xl border border-white/8 bg-white/3 backdrop-blur-md px-5 hover:border-white/15 transition-colors open:bg-white/5">
            <summary className="flex items-center justify-between gap-4 py-4 cursor-pointer list-none text-sm md:text-base font-medium text-slate-100">
                {q}
                <ChevronDown className="w-4 h-4 text-slate-400 transition-transform group-open:rotate-180" />
            </summary>
            <p className="text-sm text-slate-400 leading-relaxed pb-5 -mt-1">{a}</p>
        </details>
    );
}

function TeamCard({
    member,
    delay,
}: {
    member: { name: string; role: string; img?: string; links?: { kind: 'mail' | 'instagram' | 'linkedin'; href: string }[] };
    delay: number;
}) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
            className="relative rounded-2xl overflow-hidden border border-white/8 bg-navy-900/40 aspect-3/4 flex flex-col justify-end hover:border-white/20 transition-colors group"
        >
            {member.img ? (
                <img
                    src={member.img}
                    alt={member.name}
                    className="absolute inset-0 w-full h-full object-cover"
                />
            ) : (
                <div className="absolute inset-0 bg-linear-to-br from-white/5 via-white/3 to-transparent flex items-center justify-center">
                    <User className="w-20 h-20 text-white/15" strokeWidth={1.25} />
                </div>
            )}

            {/* Bottom darkening for legibility */}
            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-black/85 via-black/40 to-transparent pointer-events-none" />

            {/* Body */}
            <div className="relative p-5 z-10 space-y-2">
                <p className="text-[11px] uppercase tracking-widest text-slate-300">{member.role}</p>
                <p className="text-lg font-semibold text-white">{member.name}</p>
                {member.links && (
                    <div className="flex items-center gap-2 pt-1">
                        {member.links.map((l) => (
                            <a
                                key={l.kind + l.href}
                                href={l.href}
                                target={l.kind === 'mail' ? undefined : '_blank'}
                                rel={l.kind === 'mail' ? undefined : 'noopener noreferrer'}
                                aria-label={l.kind}
                                className="w-7 h-7 rounded-full flex items-center justify-center text-slate-200 hover:text-white bg-white/8 hover:bg-white/15 transition-colors"
                            >
                                {l.kind === 'mail' && <Mail className="w-3.5 h-3.5" />}
                                {l.kind === 'instagram' && <Instagram className="w-3.5 h-3.5" />}
                                {l.kind === 'linkedin' && <Linkedin className="w-3.5 h-3.5" />}
                            </a>
                        ))}
                    </div>
                )}
            </div>
        </motion.div>
    );
}
