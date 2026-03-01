/**
 * Navbar — sticky top navigation for the landing page.
 * Scroll-aware: transparent at top, solid on scroll.
 */

import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Sparkles, Menu, X } from 'lucide-react';

export function Navbar() {
    const [scrolled, setScrolled] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const navigate = useNavigate();

    useEffect(() => {
        const handle = () => setScrolled(window.scrollY > 20);
        window.addEventListener('scroll', handle);
        return () => window.removeEventListener('scroll', handle);
    }, []);

    const navLinks = [
        { label: 'Features', href: '#features' },
        { label: 'How It Works', href: '#how-it-works' },
    ];

    return (
        <nav
            className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled
                    ? 'glass shadow-lg shadow-black/20'
                    : 'bg-transparent'
                }`}
        >
            <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
                {/* Brand */}
                <Link to="/" className="flex items-center gap-3 group">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-500/25 group-hover:shadow-primary-500/40 transition-shadow">
                        <Sparkles className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h1 className="text-lg font-bold tracking-tight gradient-text">
                            Cognito Stream
                        </h1>
                        <p className="text-[10px] text-slate-400 -mt-0.5 uppercase tracking-widest">
                            AI Video Engine
                        </p>
                    </div>
                </Link>

                {/* Desktop links */}
                <div className="hidden md:flex items-center gap-8">
                    {navLinks.map((link) => (
                        <a
                            key={link.href}
                            href={link.href}
                            className="text-sm text-slate-400 hover:text-primary-300 transition-colors font-medium"
                        >
                            {link.label}
                        </a>
                    ))}
                    <button
                        onClick={() => navigate('/dashboard')}
                        className="btn-primary text-sm px-6 py-2.5"
                    >
                        Get Started
                    </button>
                </div>

                {/* Mobile toggle */}
                <button
                    className="md:hidden text-slate-300 hover:text-white transition-colors"
                    onClick={() => setMobileOpen(!mobileOpen)}
                    aria-label="Toggle menu"
                >
                    {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                </button>
            </div>

            {/* Mobile menu */}
            {mobileOpen && (
                <div className="md:hidden glass-light border-t border-white/5 px-6 py-4 space-y-3">
                    {navLinks.map((link) => (
                        <a
                            key={link.href}
                            href={link.href}
                            onClick={() => setMobileOpen(false)}
                            className="block text-sm text-slate-400 hover:text-primary-300 transition-colors py-2"
                        >
                            {link.label}
                        </a>
                    ))}
                    <button
                        onClick={() => {
                            setMobileOpen(false);
                            navigate('/dashboard');
                        }}
                        className="btn-primary w-full text-sm py-2.5 text-center"
                    >
                        Get Started
                    </button>
                </div>
            )}
        </nav>
    );
}
