import { SparklesIcon } from '@heroicons/react/24/solid';

interface HeaderProps {
    showPromptForm?: boolean;
}

export const Header = ({ showPromptForm = true }: HeaderProps) => {
    return (
        <header className="mb-8">
            {/* Brand */}
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple-600 to-purple-400 text-white shadow-lg shadow-purple-500/20">
                    <SparklesIcon className="h-5 w-5" />
                </div>
                <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-purple-400">
                        Cognito Stream
                    </p>
                    <p className="text-sm text-slate-500">AI Video Generation</p>
                </div>
            </div>

            {/* Title */}
            <h1 className="mt-6 text-3xl font-bold leading-tight text-white sm:text-4xl lg:text-5xl">
                Transform <span className="bg-gradient-to-r from-purple-400 to-purple-600 bg-clip-text text-transparent">ideas</span> into
                <br />
                narrated learning videos
            </h1>

            <p className="mt-4 max-w-2xl text-base text-slate-400 lg:text-lg">
                Generate structured storyboards with AI, edit Manim operations,
                and render professional educational videos — all in your browser.
            </p>

            {/* Feature pills */}
            {showPromptForm && (
                <div className="mt-6 flex flex-wrap gap-2">
                    {['Gemini AI', 'ElevenLabs TTS', 'Manim Rendering'].map((feature) => (
                        <span
                            key={feature}
                            className="rounded-full border border-slate-700 bg-slate-800/50 px-3 py-1 text-xs font-medium text-slate-300"
                        >
                            {feature}
                        </span>
                    ))}
                </div>
            )}
        </header>
    );
};

export default Header;
