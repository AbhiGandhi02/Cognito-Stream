/**
 * Navbar — minimal sticky nav. Quiet by default; gains a hairline border
 * when the user scrolls past the hero. Single-letter mark, no gradient
 * brand box.
 */

import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Menu, X, LogOut, Shield } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useMe } from '../hooks/useMe';
import { ThemeToggle } from './ThemeToggle';

export function Navbar() {
    const [scrolled, setScrolled] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const navigate = useNavigate();
    const { session, signOut } = useAuth();
    const { isAdmin } = useMe();

    useEffect(() => {
        const handle = () => setScrolled(window.scrollY > 20);
        window.addEventListener('scroll', handle);
        return () => window.removeEventListener('scroll', handle);
    }, []);

    const navLinks = [
        { label: 'Home', href: '/' },
        { label: 'Features', href: '/#features' },
        { label: 'Examples', href: '/#examples' },
        { label: 'How it works', href: '/#how-it-works' },
        { label: 'Contact', href: '/contact' },
    ];

    return (
        <nav
            className={`fixed left-0 right-0 z-50 px-3 transition-[top,padding] duration-500 ease-out ${scrolled ? 'top-6' : 'top-0 pt-3'
                }`}
        >
            <div
                className={`relative mx-auto flex items-center justify-between transition-all duration-500 ease-out ${scrolled
                    ? 'max-w-4xl px-5 py-2 rounded-2xl border border-white/10 bg-navy-950/85 backdrop-blur-xl shadow-[0_10px_30px_-12px_rgba(0,0,0,0.55)]'
                    : 'max-w-6xl px-6 py-3.5 rounded-none border border-transparent'
                    }`}
            >
                {/* Brand — wordmark only */}
                <Link to="/" className="flex items-center gap-2 group">
                    <div className="w-7 h-7 rounded-md bg-primary-500/15 border border-primary-500/30 flex items-center justify-center">
                        <span className="text-primary-300 text-sm font-semibold">C</span>
                    </div>
                    <span className="text-sm font-medium text-slate-200 tracking-tight">
                        Cognito Stream
                    </span>
                </Link>

                {/* Desktop links — absolutely centered so the right cluster
                    floats freely against the right edge. */}
                <div className="hidden md:flex absolute left-1/2 -translate-x-1/2 items-center gap-1">
                    {navLinks.map((link) => {
                        const className = "text-sm text-slate-400 hover:text-slate-100 transition-colors px-3 py-1.5 rounded-md";
                        const isInternalRoute = link.href.startsWith('/') && !link.href.startsWith('//');
                        return isInternalRoute ? (
                            <Link key={link.href} to={link.href} className={className}>
                                {link.label}
                            </Link>
                        ) : (
                            <a key={link.href} href={link.href} className={className}>
                                {link.label}
                            </a>
                        );
                    })}
                </div>

                {/* Right cluster — auth + theme */}
                <div className="hidden md:flex items-center gap-2">
                    {session ? (
                        <div className="flex items-center gap-2">
                            {isAdmin && (
                                <button
                                    onClick={() => navigate('/admin')}
                                    className="btn-secondary text-sm flex items-center gap-1.5"
                                    title="Admin dashboard"
                                >
                                    <Shield className="w-3.5 h-3.5" />
                                    Admin
                                </button>
                            )}
                            <ThemeToggle />
                            <button
                                onClick={() => navigate('/dashboard')}
                                className="btn-primary text-sm"
                            >
                                Dashboard
                            </button>
                            <button
                                onClick={async () => {
                                    await signOut();
                                    navigate('/');
                                }}
                                className="btn-secondary text-sm flex items-center gap-1.5"
                                title="Sign out"
                                aria-label="Sign out"
                            >
                                <LogOut className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <ThemeToggle />
                            <button
                                onClick={() => navigate('/login')}
                                className="btn-primary text-sm"
                            >
                                Login
                            </button>
                        </div>
                    )}
                </div>

                {/* Mobile toggle + theme */}
                <div className="md:hidden flex items-center gap-1">
                    <ThemeToggle />
                    <button
                        className="text-slate-300 hover:text-slate-100 transition-colors p-1.5"
                        onClick={() => setMobileOpen(!mobileOpen)}
                        aria-label="Toggle menu"
                    >
                        {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                    </button>
                </div>
            </div>

            {/* Mobile menu */}
            {mobileOpen && (
                <div className="md:hidden border-t border-white/5 px-6 py-4 space-y-1 bg-navy-950/95 backdrop-blur-md">
                    {navLinks.map((link) => {
                        const className = "block text-sm text-slate-400 hover:text-slate-100 transition-colors py-2";
                        const isInternalRoute = link.href.startsWith('/') && !link.href.startsWith('//');
                        return isInternalRoute ? (
                            <Link
                                key={link.href}
                                to={link.href}
                                onClick={() => setMobileOpen(false)}
                                className={className}
                            >
                                {link.label}
                            </Link>
                        ) : (
                            <a
                                key={link.href}
                                href={link.href}
                                onClick={() => setMobileOpen(false)}
                                className={className}
                            >
                                {link.label}
                            </a>
                        );
                    })}
                    <button
                        onClick={() => {
                            setMobileOpen(false);
                            navigate('/dashboard');
                        }}
                        className="btn-primary w-full text-sm mt-3"
                    >
                        Open dashboard
                    </button>
                </div>
            )}
        </nav>
    );
}
