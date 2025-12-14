import { useState, useRef } from 'react';
import { PlayIcon, PauseIcon, ArrowDownTrayIcon, ArrowsPointingOutIcon } from '@heroicons/react/24/solid';

interface VideoPlayerProps {
    src: string;
    title?: string;
    duration?: number;
    poster?: string;
    onDownload?: () => void;
    compact?: boolean;
}

const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const VideoPlayer = ({
    src,
    title,
    duration,
    poster,
    onDownload,
    compact = false,
}: VideoPlayerProps) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [currentTime, setCurrentTime] = useState(0);
    const [showControls, setShowControls] = useState(false);

    const handlePlayPause = () => {
        if (videoRef.current) {
            if (isPlaying) {
                videoRef.current.pause();
            } else {
                videoRef.current.play();
            }
            setIsPlaying(!isPlaying);
        }
    };

    const handleTimeUpdate = () => {
        if (videoRef.current) {
            setCurrentTime(videoRef.current.currentTime);
        }
    };

    const handleLoadedData = () => {
        setIsLoading(false);
    };

    const handleFullscreen = () => {
        if (videoRef.current) {
            if (document.fullscreenElement) {
                document.exitFullscreen();
            } else {
                videoRef.current.requestFullscreen();
            }
        }
    };

    const handleDownload = async () => {
        if (onDownload) {
            onDownload();
            return;
        }
        try {
            const response = await fetch(src);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = title ? `${title}.mp4` : 'video.mp4';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Download failed:', error);
        }
    };

    const videoDuration = duration || (videoRef.current?.duration ?? 0);
    const progress = videoDuration > 0 ? (currentTime / videoDuration) * 100 : 0;

    if (compact) {
        return (
            <div
                className="group relative aspect-video cursor-pointer overflow-hidden rounded-xl border border-slate-700 bg-black"
                onClick={handlePlayPause}
            >
                {isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-800 animate-pulse" />
                )}

                <video
                    ref={videoRef}
                    src={src}
                    poster={poster}
                    className="aspect-video w-full object-cover"
                    onLoadedData={handleLoadedData}
                    onTimeUpdate={handleTimeUpdate}
                    onEnded={() => setIsPlaying(false)}
                />

                <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                    <button className="rounded-full bg-purple-600/90 p-4 text-white transition-transform hover:scale-110">
                        {isPlaying ? <PauseIcon className="h-8 w-8" /> : <PlayIcon className="h-8 w-8" />}
                    </button>
                </div>

                {videoDuration > 0 && (
                    <div className="absolute bottom-2 right-2 rounded bg-black/70 px-2 py-0.5 text-xs font-medium text-white">
                        {formatDuration(videoDuration)}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div
            className="relative overflow-hidden rounded-xl border border-slate-700 bg-black"
            onMouseEnter={() => setShowControls(true)}
            onMouseLeave={() => setShowControls(false)}
        >
            {isLoading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-900">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
                </div>
            )}

            <video
                ref={videoRef}
                src={src}
                poster={poster}
                className="w-full"
                onLoadedData={handleLoadedData}
                onTimeUpdate={handleTimeUpdate}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
                controls={false}
            />

            <div
                className={`absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/80 via-transparent to-transparent transition-opacity duration-200 ${showControls || !isPlaying ? 'opacity-100' : 'opacity-0'
                    }`}
            >
                <button
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple-600/90 p-5 text-white transition-transform hover:scale-110"
                    onClick={handlePlayPause}
                >
                    {isPlaying ? <PauseIcon className="h-8 w-8" /> : <PlayIcon className="h-8 w-8" />}
                </button>

                <div className="px-4 pb-4">
                    <div className="mb-3 h-1 w-full overflow-hidden rounded-full bg-white/30">
                        <div
                            className="h-full rounded-full bg-purple-500 transition-all duration-100"
                            style={{ width: `${progress}%` }}
                        />
                    </div>

                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <span className="text-sm text-white">
                                {formatDuration(currentTime)} / {formatDuration(videoDuration)}
                            </span>
                            {title && (
                                <span className="text-sm text-slate-300 line-clamp-1">{title}</span>
                            )}
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                className="rounded-lg p-2 text-white transition-colors hover:bg-white/20"
                                onClick={handleDownload}
                                title="Download video"
                            >
                                <ArrowDownTrayIcon className="h-5 w-5" />
                            </button>
                            <button
                                className="rounded-lg p-2 text-white transition-colors hover:bg-white/20"
                                onClick={handleFullscreen}
                                title="Fullscreen"
                            >
                                <ArrowsPointingOutIcon className="h-5 w-5" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default VideoPlayer;
