/**
 * VideoPlayer — embedded video player with controls.
 * Shows the rendered scene/final video in a styled dark container.
 */

import { useRef, useState } from 'react';
import {
    PlayCircleIcon,
    PauseCircleIcon,
    ArrowsPointingOutIcon,
} from '@heroicons/react/24/solid';

interface VideoPlayerProps {
    videoUrl: string | null | undefined;
    title?: string;
    className?: string;
}

export function VideoPlayer({ videoUrl, title, className = '' }: VideoPlayerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);

    const togglePlay = () => {
        if (!videoRef.current) return;
        if (isPlaying) {
            videoRef.current.pause();
        } else {
            videoRef.current.play();
        }
        setIsPlaying(!isPlaying);
    };

    const toggleFullscreen = () => {
        if (!videoRef.current) return;
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            videoRef.current.requestFullscreen();
        }
    };

    // Construct full URL for the video
    const fullVideoUrl = videoUrl
        ? videoUrl.startsWith('http')
            ? videoUrl
            : `${import.meta.env.VITE_API_URL || 'http://localhost:3000'}${videoUrl}`
        : null;

    if (!fullVideoUrl) {
        return (
            <div
                className={`rounded-2xl bg-surface-900/60 border border-white/5 flex flex-col items-center justify-center text-surface-200/30 ${className}`}
                style={{ minHeight: 300 }}
            >
                <PlayCircleIcon className="w-16 h-16 mb-3 opacity-20" />
                <p className="text-sm">No video available</p>
                <p className="text-xs mt-1 opacity-50">Generate scenes to preview</p>
            </div>
        );
    }

    return (
        <div className={`rounded-2xl overflow-hidden bg-black/40 border border-white/5 relative group ${className}`}>
            {/* Title overlay */}
            {title && (
                <div className="absolute top-0 left-0 right-0 z-10 p-3 bg-gradient-to-b from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className="text-xs text-white/80 font-medium">{title}</p>
                </div>
            )}

            {/* Video element */}
            <video
                ref={videoRef}
                src={fullVideoUrl}
                className="w-full h-full object-contain"
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
                controls={false}
            />

            {/* Overlay controls */}
            <div className="absolute bottom-0 left-0 right-0 z-10 p-3 bg-gradient-to-t from-black/70 to-transparent flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                    onClick={togglePlay}
                    className="text-white/90 hover:text-white transition-colors"
                >
                    {isPlaying ? (
                        <PauseCircleIcon className="w-8 h-8" />
                    ) : (
                        <PlayCircleIcon className="w-8 h-8" />
                    )}
                </button>

                <button
                    onClick={toggleFullscreen}
                    className="text-white/60 hover:text-white transition-colors"
                >
                    <ArrowsPointingOutIcon className="w-5 h-5" />
                </button>
            </div>

            {/* Click to play overlay (shown when paused) */}
            {!isPlaying && (
                <button
                    onClick={togglePlay}
                    className="absolute inset-0 flex items-center justify-center z-5 cursor-pointer bg-transparent"
                >
                    <PlayCircleIcon className="w-16 h-16 text-white/50 hover:text-white/80 transition-colors drop-shadow-lg" />
                </button>
            )}
        </div>
    );
}
