/**
 * Footer — minimal site footer. Single line on desktop, stacked on mobile.
 */

export function Footer() {
    return (
        <footer className="border-t border-white/5 py-8 px-6">
            <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
                <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-md bg-primary-500/15 border border-primary-500/30 flex items-center justify-center">
                        <span className="text-primary-300 text-[10px] font-semibold">C</span>
                    </div>
                    <span className="text-slate-400">Cognito Stream</span>
                    <span className="text-slate-600">·</span>
                    <span>&copy; {new Date().getFullYear()}</span>
                </div>

                <div className="flex items-center gap-5">
                    <a href="#features" className="hover:text-slate-200 transition-colors">Features</a>
                    <a href="#examples" className="hover:text-slate-200 transition-colors">Examples</a>
                    <a href="#how-it-works" className="hover:text-slate-200 transition-colors">How it works</a>
                    <a href="/dashboard" className="hover:text-slate-200 transition-colors">Dashboard</a>
                </div>
            </div>
        </footer>
    );
}
