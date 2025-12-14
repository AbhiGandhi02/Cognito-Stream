# ==========================================
# VIDEO PROCESSOR
# renderer/utils/video_processor.py
# ==========================================

import subprocess
import logging
from pathlib import Path
from typing import List, Tuple

logger = logging.getLogger(__name__)

class VideoProcessor:
    """Handle video processing operations with FFmpeg"""
    
    def __init__(self):
        self.ffmpeg = 'ffmpeg'
        self.ffprobe = 'ffprobe'
    
    def get_duration(self, video_path: Path) -> float:
        """Get video duration in seconds"""
        cmd = [
            self.ffprobe,
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            str(video_path)
        ]
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=10
            )
            return float(result.stdout.strip())
        except Exception as e:
            logger.error(f"Failed to get duration: {e}")
            return 0.0
    
    def get_resolution(self, video_path: Path) -> Tuple[int, int]:
        """Get video resolution (width, height)"""
        cmd = [
            self.ffprobe,
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height',
            '-of', 'csv=s=x:p=0',
            str(video_path)
        ]
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=10
            )
            width, height = map(int, result.stdout.strip().split('x'))
            return width, height
        except Exception as e:
            logger.error(f"Failed to get resolution: {e}")
            return 0, 0
    
    def add_audio(
        self,
        video_path: Path,
        audio_path: Path,
        output_path: Path,
        audio_bitrate: str = '192k'
    ) -> Path:
        """Add audio track to video"""
        cmd = [
            self.ffmpeg,
            '-i', str(video_path),
            '-i', str(audio_path),
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-b:a', audio_bitrate,
            '-shortest',
            '-y',
            str(output_path)
        ]
        
        subprocess.run(cmd, check=True, capture_output=True, timeout=60)
        return output_path
    
    def concatenate(
        self,
        video_paths: List[Path],
        output_path: Path,
        temp_dir: Path
    ) -> Path:
        """Concatenate multiple videos"""
        # Create concat file
        concat_file = temp_dir / 'concat_list.txt'
        
        with open(concat_file, 'w') as f:
            for path in video_paths:
                f.write(f"file '{path.resolve()}'\n")
        
        cmd = [
            self.ffmpeg,
            '-f', 'concat',
            '-safe', '0',
            '-i', str(concat_file),
            '-c', 'copy',
            '-y',
            str(output_path)
        ]
        
        subprocess.run(cmd, check=True, capture_output=True, timeout=120)
        concat_file.unlink()
        
        return output_path
    
    def resize(
        self,
        video_path: Path,
        output_path: Path,
        width: int,
        height: int
    ) -> Path:
        """Resize video to specified dimensions"""
        cmd = [
            self.ffmpeg,
            '-i', str(video_path),
            '-vf', f'scale={width}:{height}',
            '-c:a', 'copy',
            '-y',
            str(output_path)
        ]
        
        subprocess.run(cmd, check=True, capture_output=True, timeout=60)
        return output_path
    
    def add_watermark(
        self,
        video_path: Path,
        output_path: Path,
        text: str,
        position: str = 'bottom-right'
    ) -> Path:
        """Add text watermark to video"""
        positions = {
            'top-left': 'x=10:y=10',
            'top-right': 'x=w-tw-10:y=10',
            'bottom-left': 'x=10:y=h-th-10',
            'bottom-right': 'x=w-tw-10:y=h-th-10',
            'center': 'x=(w-tw)/2:y=(h-th)/2'
        }
        
        pos = positions.get(position, positions['bottom-right'])
        
        cmd = [
            self.ffmpeg,
            '-i', str(video_path),
            '-vf', f"drawtext=text='{text}':fontsize=24:fontcolor=white@0.5:{pos}",
            '-codec:a', 'copy',
            '-y',
            str(output_path)
        ]
        
        subprocess.run(cmd, check=True, capture_output=True, timeout=60)
        return output_path