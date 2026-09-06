/**
 * Footer — multi-column site footer in the doubtflix style.
 *
 * Top: brand + tagline (col 1) and three link groups (Platform / Legal /
 * Get in touch). A "Built with" row of monochrome wordmarks sits below.
 * Bottom row carries the copyright and the theme toggle.
 */

import { Github, Mail, Linkedin, Instagram } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ThemeToggle } from './ThemeToggle';

const platformLinks = [
    { label: 'Features', href: '#features' },
    { label: 'How it works', href: '#how-it-works' },
    { label: 'Examples', href: '#examples' },
    { label: 'Dashboard', href: '/dashboard' },
];

const legalLinks = [
    { label: 'Privacy Policy', href: '/privacy' },
    { label: 'Terms of Service', href: '/terms' },
    { label: 'Acceptable Use', href: '/acceptable-use' },
];

export function Footer() {
    return (
        <footer className="relative border-t border-white/5 px-6 pt-12 pb-8">
            <div className="max-w-6xl mx-auto">
                {/* Top — 4 column grid: brand (wider) + 3 link columns */}
                <div className="grid grid-cols-1 md:grid-cols-[1.6fr_1fr_1fr_1fr] gap-10 md:gap-12">
                    {/* Brand */}
                    <div className="space-y-4 max-w-sm">
                        <div className="flex items-center gap-2">
                            <img
                                src="/image.png"
                                alt="Cognito Stream"
                                className="w-8 h-8 rounded-md object-cover"
                            />
                            <span className="text-base font-semibold text-slate-100 tracking-tight">
                                Cognito Stream
                            </span>
                        </div>
                        <p className="text-sm text-slate-500 leading-relaxed">
                            Turn any idea into a narrated 2D animation. The AI plans the scenes, writes the Manim code, voices the narration, and ships you a finished mp4.
                        </p>
                    </div>

                    {/* Platform */}
                    <FooterColumn title="Platform">
                        {platformLinks.map((link) => (
                            <FooterLink key={link.href} href={link.href}>
                                {link.label}
                            </FooterLink>
                        ))}
                    </FooterColumn>

                    {/* Legal */}
                    <FooterColumn title="Legal">
                        {legalLinks.map((link) => (
                            <FooterLink key={link.label} href={link.href}>
                                {link.label}
                            </FooterLink>
                        ))}
                    </FooterColumn>

                    {/* Get in touch */}
                    <FooterColumn title="Get in touch">
                        <FooterLink href="/contact#faq">Support FAQ</FooterLink>
                        <a
                            href="mailto:abhigandhi0212@gmail.com"
                            className="text-sm text-slate-400 hover:text-slate-100 transition-colors"
                        >
                            abhigandhi0212@gmail.com
                        </a>
                        <div className="flex items-center gap-3 pt-1">
                            <SocialIcon href="https://github.com/AbhiGandhi02" aria="GitHub">
                                <Github className="w-4 h-4" />
                            </SocialIcon>
                            <SocialIcon href="https://www.linkedin.com/in/abhigandhi02/" aria="LinkedIn">
                                <Linkedin className="w-4 h-4" />
                            </SocialIcon>
                            <SocialIcon href="https://instagram.com/abhi_gandhi02" aria="Instagram">
                                <Instagram className="w-4 h-4" />
                            </SocialIcon>
                            <SocialIcon href="mailto:abhigandhi0212@gmail.com" aria="Email">
                                <Mail className="w-4 h-4" />
                            </SocialIcon>
                        </div>
                    </FooterColumn>
                </div>

                {/* Built with — tech-stack wordmarks */}
                <div className="mt-14 flex flex-wrap items-center gap-x-8 gap-y-4">
                    <span className="text-xs uppercase tracking-widest text-slate-600">
                        Built with
                    </span>
                    <BrandWordmark name="Manim" />
                    <BrandWordmark name="Gemini" />
                    <BrandWordmark name="Piper TTS" />
                    <BrandWordmark name="Supabase" />
                </div>

                {/* Divider */}
                <div className="mt-12 mb-6 h-px bg-white/5" />

                {/* Bottom row */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
                    <span>
                        Copyright &copy; {new Date().getFullYear()} Cognito Stream. All rights reserved.
                    </span>
                    <ThemeToggle />
                </div>
            </div>
        </footer>
    );
}

// ============================================================
// PIECES
// ============================================================

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="space-y-3">
            <h4 className="text-sm font-semibold text-slate-100 tracking-tight">{title}</h4>
            <div className="flex flex-col gap-2.5">{children}</div>
        </div>
    );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
    const className = "text-sm text-slate-400 hover:text-slate-100 transition-colors w-fit";
    // Use react-router for internal routes so we don't trigger a full page
    // reload. Anchor links (`#features`) and external URLs stay as plain <a>.
    const isInternalRoute = href.startsWith('/') && !href.startsWith('//');
    if (isInternalRoute) {
        return <Link to={href} className={className}>{children}</Link>;
    }
    return <a href={href} className={className}>{children}</a>;
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
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-100 border border-white/8 hover:border-white/20 bg-white/2 hover:bg-white/6 transition-colors"
        >
            {children}
        </a>
    );
}

/** Plain monochrome wordmark for the "built with" row.
 *  No external brand assets — keeps the footer cohesive with the design system. */
function BrandWordmark({ name }: { name: string }) {
    return (
        <span className="text-sm font-semibold tracking-tight text-slate-300 hover:text-slate-100 transition-colors cursor-default">
            {name}
        </span>
    );
}
