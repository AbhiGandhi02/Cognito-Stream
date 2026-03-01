/**
 * Footer — site footer with brand, links, and credits.
 */

import { Sparkles } from 'lucide-react';

export function Footer() {
    return (
        <footer className="relative border-t border-white/5 py-12 px-6">
            <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
                {/* Brand */}
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center">
                        <Sparkles className="w-4 h-4 text-white" />
                    </div>
                    <span className="font-semibold text-slate-300">Cognito Stream</span>
                </div>

                {/* Links */}
                <div className="flex items-center gap-6 text-sm text-slate-500">
                    <a href="#features" className="hover:text-primary-300 transition-colors">Features</a>
                    <a href="#how-it-works" className="hover:text-primary-300 transition-colors">How It Works</a>
                    <a href="/dashboard" className="hover:text-primary-300 transition-colors">Dashboard</a>
                </div>

                {/* Credits */}
                <p className="text-xs text-slate-600">
                    &copy; {new Date().getFullYear()} Cognito Stream. Powered by AI.
                </p>
            </div>
        </footer>
    );
}
