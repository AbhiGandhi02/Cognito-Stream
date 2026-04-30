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

export function Navbar() {
    const [scrolled, setScrolled] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const navigate = useNavigate();
    const { session, user, signOut } = useAuth();
    const { isAdmin } = useMe();

    useEffect(() => {
        const handle = () => setScrolled(window.scrollY > 20);
        window.addEventListener('scroll', handle);
        return () => window.removeEventListener('scroll', handle);
    }, []);

    const navLinks = [
        { label: 'Features', href: '#features' },
        { label: 'Examples', href: '#examples' },
        { label: 'How it works', href: '#how-it-works' },
    ];

    return (
        <nav
            className={`fixed top-0 left-0 right-0 z-50 transition-colors duration-200 ${scrolled
                ? 'border-b border-white/5 bg-navy-950/85 backdrop-blur-md'
                : 'bg-transparent'
                }`}
        >
            <div className="max-w-6xl mx-auto px-6 py-3.5 flex items-center justify-between">
                {/* Brand — wordmark only */}
                <Link to="/" className="flex items-center gap-2 group">
                    <div className="w-7 h-7 rounded-md bg-primary-500/15 border border-primary-500/30 flex items-center justify-center">
                        <span className="text-primary-300 text-sm font-semibold">C</span>
                    </div>
                    <span className="text-sm font-medium text-slate-200 tracking-tight">
                        Cognito Stream
                    </span>
                </Link>

                {/* Desktop links */}
                <div className="hidden md:flex items-center gap-1">
                    {navLinks.map((link) => (
                        <a
                            key={link.href}
                            href={link.href}
                            className="text-sm text-slate-400 hover:text-slate-100 transition-colors px-3 py-1.5 rounded-md"
                        >
                            {link.label}
                        </a>
                    ))}
                    {session ? (
                        <div className="ml-3 flex items-center gap-2">
                            <span className="text-xs text-slate-500 max-w-40 truncate" title={user?.email ?? ''}>
                                {user?.email}
                            </span>
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
                            >
                                <LogOut className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    ) : (
                        <div className="ml-3 flex items-center gap-2">
                            <button
                                onClick={() => navigate('/login')}
                                className="btn-secondary text-sm"
                            >
                                Sign in
                            </button>
                            <button
                                onClick={() => navigate('/signup')}
                                className="btn-primary text-sm"
                            >
                                Get started
                            </button>
                        </div>
                    )}
                </div>

                {/* Mobile toggle */}
                <button
                    className="md:hidden text-slate-300 hover:text-slate-100 transition-colors"
                    onClick={() => setMobileOpen(!mobileOpen)}
                    aria-label="Toggle menu"
                >
                    {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                </button>
            </div>

            {/* Mobile menu */}
            {mobileOpen && (
                <div className="md:hidden border-t border-white/5 px-6 py-4 space-y-1 bg-navy-950/95 backdrop-blur-md">
                    {navLinks.map((link) => (
                        <a
                            key={link.href}
                            href={link.href}
                            onClick={() => setMobileOpen(false)}
                            className="block text-sm text-slate-400 hover:text-slate-100 transition-colors py-2"
                        >
                            {link.label}
                        </a>
                    ))}
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
