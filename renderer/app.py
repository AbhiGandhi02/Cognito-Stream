from flask import Flask, request, jsonify, send_from_directory
from manim import *
import subprocess
import os
import json
import tempfile
import shutil
from pathlib import Path
import logging
import traceback
import time
from datetime import datetime

# ==========================================
# CONFIGURATION
# ==========================================

app = Flask(__name__)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Directories
OUTPUT_DIR = Path(os.getenv('OUTPUT_DIR', '/app/output'))
TEMP_DIR = Path(os.getenv('TEMP_DIR', '/app/temp'))
AUDIO_DIR = Path(os.getenv('AUDIO_DIR', '/app/audio'))

# Create directories
OUTPUT_DIR.mkdir(exist_ok=True, parents=True)
TEMP_DIR.mkdir(exist_ok=True, parents=True)
AUDIO_DIR.mkdir(exist_ok=True, parents=True)

# Quality presets
QUALITY_PRESETS = {
    'low': {
        'quality': 'low_quality',
        'resolution': '854,480',
        'fps': 24,
        'bitrate': '1000k'
    },
    'medium': {
        'quality': 'medium_quality',
        'resolution': '1280,720',
        'fps': 30,
        'bitrate': '2500k'
    },
    'high': {
        'quality': 'high_quality',
        'resolution': '1920,1080',
        'fps': 30,
        'bitrate': '5000k'
    },
    'ultra': {
        'quality': 'production_quality',
        'resolution': '2560,1440',
        'fps': 60,
        'bitrate': '8000k'
    }
}

# Statistics
stats = {
    'total_renders': 0,
    'successful_renders': 0,
    'failed_renders': 0,
    'total_render_time': 0,
    'start_time': datetime.now()
}

# ==========================================
# SAFE MANIM ENVIRONMENT
# ==========================================

# Whitelist of allowed Manim objects and functions
SAFE_GLOBALS = {
    # Basic objects
    'Text': Text,
    'MathTex': MathTex,
    'Tex': Tex,
    
    # Shapes
    'Circle': Circle,
    'Square': Square,
    'Rectangle': Rectangle,
    'Triangle': Triangle,
    'Polygon': Polygon,
    'RegularPolygon': RegularPolygon,
    'Dot': Dot,
    'Ellipse': Ellipse,
    'Arc': Arc,
    'Sector': Sector,
    'Annulus': Annulus,
    
    # Lines and Arrows
    'Line': Line,
    'Arrow': Arrow,
    'Vector': Vector,
    'DoubleArrow': DoubleArrow,
    'DashedLine': DashedLine,
    
    # 3D Objects (basic)
    'Sphere': Sphere,
    'Cube': Cube,
    'Cone': Cone,
    'Cylinder': Cylinder,
    
    # Coordinates
    'NumberPlane': NumberPlane,
    'Axes': Axes,
    'NumberLine': NumberLine,
    'ComplexPlane': ComplexPlane,
    
    # Groups
    'VGroup': VGroup,
    'VDict': VDict,
    
    # Colors
    'RED': RED,
    'BLUE': BLUE,
    'GREEN': GREEN,
    'YELLOW': YELLOW,
    'PURPLE': PURPLE,
    'ORANGE': ORANGE,
    'PINK': PINK,
    'WHITE': WHITE,
    'BLACK': BLACK,
    'GRAY': GRAY,
    'GREY': GREY,
    'LIGHT_GRAY': LIGHT_GRAY,
    'DARK_GRAY': DARK_GRAY,
    'MAROON': MAROON,
    'TEAL': TEAL,
    'GOLD': GOLD,
    
    # Directions
    'UP': UP,
    'DOWN': DOWN,
    'LEFT': LEFT,
    'RIGHT': RIGHT,
    'IN': IN,
    'OUT': OUT,
    'ORIGIN': ORIGIN,
    'UL': UL,
    'UR': UR,
    'DL': DL,
    'DR': DR,
    
    # Constants
    'PI': PI,
    'TAU': TAU,
    'DEGREES': DEGREES,
    
    # Math functions
    'np': np,
}

# ==========================================
# HELPER FUNCTIONS
# ==========================================

def validate_manim_code(code_list):
    """Validate Manim code for security"""
    dangerous_patterns = [
        'import', 'exec', 'eval', 'open', 'file', '__import__',
        'compile', 'globals', 'locals', 'vars', 'dir',
        'getattr', 'setattr', 'delattr', 'hasattr',
        'input', 'raw_input', 'execfile',
        'system', 'popen', 'subprocess', 'os.',
        '__', 'lambda'
    ]
    
    for code in code_list:
        code_lower = code.lower()
        for pattern in dangerous_patterns:
            if pattern in code_lower:
                raise ValueError(f"Dangerous pattern detected: {pattern}")
    
    return True

def execute_manim_operation(operation_str):
    """Safely execute a single Manim operation"""
    try:
        # Execute in restricted environment
        obj = eval(operation_str, {"__builtins__": {}}, SAFE_GLOBALS)
        return obj
    except Exception as e:
        logger.warning(f"Failed to execute operation '{operation_str}': {e}")
        return None

def generate_scene_class(scene_id, operations, duration):
    """Generate Python code for a Manim scene class"""
    
    code = f'''from manim import *
import numpy as np

config.frame_rate = 30
config.pixel_height = 720
config.pixel_width = 1280

class Scene_{scene_id.replace("-", "_")}(Scene):
    def construct(self):
        # Set background color
        self.camera.background_color = "#1a1a1a"
        
        objects = []
        
'''
    
    # Add each operation
    for i, op in enumerate(operations):
        code += f'''        # Operation {i+1}: {op[:50]}...
        try:
            obj_{i} = {op}
            if obj_{i} is not None:
                self.add(obj_{i})
                objects.append(obj_{i})
        except Exception as e:
            error_text = Text(f"Error: {{str(e)[:30]}}", color=RED, font_size=24)
            error_text.to_edge(UP)
            self.add(error_text)
            print(f"Operation {i} error: {{e}}")
        
'''
    
    # Add wait time to match audio duration
    code += f'''        # Wait for audio duration
        self.wait({duration})
'''
    
    return code

def render_scene_with_manim(scene_file, scene_id, quality='medium'):
    """Render a scene using Manim CLI"""
    
    quality_preset = QUALITY_PRESETS.get(quality, QUALITY_PRESETS['medium'])
    quality_flag = quality_preset['quality']
    
    output_file = OUTPUT_DIR / f"{scene_id}.mp4"
    
    # Build Manim command
    cmd = [
        'manim',
        'render',
        str(scene_file),
        f'Scene_{scene_id.replace("-", "_")}',
        f'-q{quality_flag[0]}',  # -ql, -qm, -qh, -qp
        '--format', 'mp4',
        '--media_dir', str(OUTPUT_DIR),
        '-o', f'{scene_id}.mp4',
        '--disable_caching',
        '--flush_cache',
        '--progress_bar', 'none'
    ]
    
    logger.info(f"Executing: {' '.join(cmd)}")
    
    start_time = time.time()
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,  # 5 minute timeout
            cwd=str(TEMP_DIR)
        )
        
        render_time = time.time() - start_time
        
        if result.returncode != 0:
            logger.error(f"Manim error: {result.stderr}")
            raise Exception(f"Manim render failed: {result.stderr}")
        
        # Find the rendered file
        possible_paths = [
            output_file,
            OUTPUT_DIR / 'videos' / f'{scene_id}.mp4',
            OUTPUT_DIR / 'videos' / str(scene_file.stem) / f'{scene_id}.mp4',
        ]
        
        for path in possible_paths:
            if path.exists():
                # Move to output directory if not already there
                if path != output_file:
                    shutil.move(str(path), str(output_file))
                logger.info(f"✓ Render complete: {output_file} ({render_time:.2f}s)")
                return output_file, render_time
        
        raise Exception("Rendered video file not found")
        
    except subprocess.TimeoutExpired:
        raise Exception("Rendering timeout exceeded (5 minutes)")
    except Exception as e:
        logger.error(f"Rendering failed: {e}")
        raise

def stitch_audio_video(video_path, audio_path, output_path):
    """Combine video and audio using FFmpeg"""
    
    logger.info(f"Stitching audio to video...")
    
    cmd = [
        'ffmpeg',
        '-i', str(video_path),
        '-i', str(audio_path),
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-shortest',
        '-y',  # Overwrite
        str(output_path)
    ]
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=60
        )
        
        if result.returncode != 0:
            raise Exception(f"FFmpeg error: {result.stderr}")
        
        logger.info(f"✓ Audio stitched successfully")
        return output_path
        
    except Exception as e:
        logger.error(f"Audio stitching failed: {e}")
        raise

def concatenate_videos(video_paths, output_path):
    """Concatenate multiple videos using FFmpeg"""
    
    logger.info(f"Concatenating {len(video_paths)} videos...")
    
    # Create concat file
    concat_file = TEMP_DIR / f'concat_{int(time.time())}.txt'
    
    with open(concat_file, 'w') as f:
        for video_path in video_paths:
            # Ensure absolute path
            abs_path = Path(video_path).resolve()
            f.write(f"file '{abs_path}'\n")
    
    cmd = [
        'ffmpeg',
        '-f', 'concat',
        '-safe', '0',
        '-i', str(concat_file),
        '-c', 'copy',
        '-y',
        str(output_path)
    ]
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=120
        )
        
        if result.returncode != 0:
            raise Exception(f"FFmpeg concat error: {result.stderr}")
        
        # Cleanup concat file
        concat_file.unlink()
        
        logger.info(f"✓ Videos concatenated successfully")
        return output_path
        
    except Exception as e:
        logger.error(f"Video concatenation failed: {e}")
        raise

def get_video_duration(video_path):
    """Get video duration using ffprobe"""
    
    cmd = [
        'ffprobe',
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
        
        duration = float(result.stdout.strip())
        return round(duration, 2)
        
    except Exception as e:
        logger.error(f"Failed to get video duration: {e}")
        return 0.0

# ==========================================
# ROUTES
# ==========================================

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    
    uptime = (datetime.now() - stats['start_time']).total_seconds()
    
    return jsonify({
        'status': 'ok',
        'service': 'cognito-renderer',
        'version': '1.0.0',
        'uptime': uptime,
        'stats': {
            'total_renders': stats['total_renders'],
            'successful_renders': stats['successful_renders'],
            'failed_renders': stats['failed_renders'],
            'success_rate': round(
                (stats['successful_renders'] / max(stats['total_renders'], 1)) * 100, 2
            ),
            'avg_render_time': round(
                stats['total_render_time'] / max(stats['successful_renders'], 1), 2
            )
        }
    }), 200

@app.route('/render', methods=['POST'])
def render_scene():
    """Render a single scene"""
    
    try:
        data = request.json
        scene_id = data.get('sceneId')
        manim_code = data.get('manimCode')
        duration = data.get('duration', 5.0)
        quality = data.get('quality', 'medium')
        
        if not scene_id or not manim_code:
            return jsonify({
                'success': False,
                'error': 'Missing required fields: sceneId and manimCode'
            }), 400
        
        logger.info(f"🎬 Rendering scene: {scene_id}")
        logger.info(f"Duration: {duration}s, Quality: {quality}")
        
        stats['total_renders'] += 1
        
        # Parse operations
        if isinstance(manim_code, str):
            operations = [op.strip() for op in manim_code.split('\n') if op.strip()]
        else:
            operations = manim_code
        
        if not operations:
            return jsonify({
                'success': False,
                'error': 'No Manim operations provided'
            }), 400
        
        logger.info(f"Operations count: {len(operations)}")
        
        # Validate code
        validate_manim_code(operations)
        
        # Generate scene file
        scene_code = generate_scene_class(scene_id, operations, duration)
        scene_file = TEMP_DIR / f'scene_{scene_id}.py'
        
        with open(scene_file, 'w') as f:
            f.write(scene_code)
        
        logger.info(f"✓ Scene file created: {scene_file}")
        
        # Render with Manim
        video_path, render_time = render_scene_with_manim(
            scene_file,
            scene_id,
            quality
        )
        
        # Update stats
        stats['successful_renders'] += 1
        stats['total_render_time'] += render_time
        
        # Get video info
        video_duration = get_video_duration(video_path)
        
        # Cleanup scene file
        scene_file.unlink()
        
        return jsonify({
            'success': True,
            'videoUrl': f'/videos/{scene_id}.mp4',
            'sceneId': scene_id,
            'duration': video_duration,
            'renderTime': round(render_time, 2)
        }), 200
        
    except Exception as e:
        logger.error(f"❌ Render error: {str(e)}")
        logger.error(traceback.format_exc())
        
        stats['failed_renders'] += 1
        
        return jsonify({
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc() if app.debug else None
        }), 500

@app.route('/assemble', methods=['POST'])
def assemble_video():
    """Assemble multiple scenes into final video"""
    
    try:
        data = request.json
        storyboard_id = data.get('storyboardId')
        scenes = data.get('scenes', [])
        quality = data.get('quality', 'medium')
        
        if not storyboard_id or not scenes:
            return jsonify({
                'success': False,
                'error': 'Missing required fields: storyboardId and scenes'
            }), 400
        
        logger.info(f"🎞️  Assembling video for: {storyboard_id}")
        logger.info(f"Scenes to assemble: {len(scenes)}")
        
        # Collect video paths
        video_paths = []
        total_duration = 0
        
        for scene in scenes:
            # Extract scene ID from URL or use directly
            video_url = scene.get('videoUrl', '')
            if '/videos/' in video_url:
                filename = video_url.split('/videos/')[-1]
            else:
                filename = f"{scene.get('sceneNumber', 'unknown')}.mp4"
            
            video_path = OUTPUT_DIR / filename
            
            if not video_path.exists():
                logger.warning(f"Video not found: {video_path}")
                continue
            
            video_paths.append(video_path)
            total_duration += scene.get('duration', 0)
        
        if not video_paths:
            return jsonify({
                'success': False,
                'error': 'No valid video files found'
            }), 400
        
        # Concatenate videos
        output_file = OUTPUT_DIR / f'{storyboard_id}_final.mp4'
        concatenate_videos(video_paths, output_file)
        
        # Verify output
        final_duration = get_video_duration(output_file)
        
        logger.info(f"✓ Final video assembled: {output_file}")
        logger.info(f"Total duration: {final_duration}s")
        
        return jsonify({
            'success': True,
            'videoUrl': f'/videos/{storyboard_id}_final.mp4',
            'storyboardId': storyboard_id,
            'totalDuration': final_duration,
            'scenesCount': len(video_paths)
        }), 200
        
    except Exception as e:
        logger.error(f"❌ Assembly error: {str(e)}")
        logger.error(traceback.format_exc())
        
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/videos/<path:filename>')
def serve_video(filename):
    """Serve rendered video files"""
    return send_from_directory(OUTPUT_DIR, filename)

@app.route('/stats', methods=['GET'])
def get_stats():
    """Get renderer statistics"""
    
    uptime = (datetime.now() - stats['start_time']).total_seconds()
    
    return jsonify({
        'uptime': uptime,
        'total_renders': stats['total_renders'],
        'successful_renders': stats['successful_renders'],
        'failed_renders': stats['failed_renders'],
        'success_rate': round(
            (stats['successful_renders'] / max(stats['total_renders'], 1)) * 100, 2
        ),
        'avg_render_time': round(
            stats['total_render_time'] / max(stats['successful_renders'], 1), 2
        ),
        'total_render_time': round(stats['total_render_time'], 2),
        'output_directory': str(OUTPUT_DIR),
        'disk_usage': get_disk_usage()
    }), 200

@app.route('/cleanup', methods=['POST'])
def cleanup_old_files():
    """Clean up old rendered files"""
    
    try:
        days_old = request.json.get('daysOld', 7)
        cutoff_time = time.time() - (days_old * 24 * 60 * 60)
        
        deleted_count = 0
        freed_space = 0
        
        for file_path in OUTPUT_DIR.glob('*.mp4'):
            if file_path.stat().st_mtime < cutoff_time:
                file_size = file_path.stat().st_size
                file_path.unlink()
                deleted_count += 1
                freed_space += file_size
        
        logger.info(f"🧹 Cleaned up {deleted_count} files, freed {freed_space / 1024 / 1024:.2f} MB")
        
        return jsonify({
            'success': True,
            'deleted_count': deleted_count,
            'freed_space_mb': round(freed_space / 1024 / 1024, 2)
        }), 200
        
    except Exception as e:
        logger.error(f"Cleanup error: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/test', methods=['GET'])
def test_render():
    """Test endpoint to verify Manim is working"""
    
    try:
        test_code = [
            'Text("Cognito Stream", color=BLUE).scale(1.5)',
            'Text("Renderer Test", color=GREEN).shift(DOWN)'
        ]
        
        scene_id = f'test_{int(time.time())}'
        
        # Generate and render test scene
        scene_code = generate_scene_class(scene_id, test_code, 3.0)
        scene_file = TEMP_DIR / f'scene_{scene_id}.py'
        
        with open(scene_file, 'w') as f:
            f.write(scene_code)
        
        video_path, render_time = render_scene_with_manim(
            scene_file,
            scene_id,
            'low'
        )
        
        scene_file.unlink()
        
        return jsonify({
            'success': True,
            'message': 'Renderer is working correctly',
            'test_video': f'/videos/{scene_id}.mp4',
            'render_time': round(render_time, 2)
        }), 200
        
    except Exception as e:
        logger.error(f"Test failed: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

def get_disk_usage():
    """Get disk usage statistics"""
    total_size = 0
    file_count = 0
    
    for file_path in OUTPUT_DIR.glob('**/*'):
        if file_path.is_file():
            total_size += file_path.stat().st_size
            file_count += 1
    
    return {
        'total_size_mb': round(total_size / 1024 / 1024, 2),
        'file_count': file_count
    }

# ==========================================
# ERROR HANDLERS
# ==========================================

@app.errorhandler(404)
def not_found(error):
    return jsonify({
        'success': False,
        'error': 'Endpoint not found'
    }), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({
        'success': False,
        'error': 'Internal server error'
    }), 500

# ==========================================
# STARTUP
# ==========================================

if __name__ == '__main__':
    logger.info("="*50)
    logger.info("🎬 Cognito Stream Renderer Service")
    logger.info("="*50)
    logger.info(f"Output directory: {OUTPUT_DIR}")
    logger.info(f"Temp directory: {TEMP_DIR}")
    logger.info("Starting server...")
    
    app.run(
        host='0.0.0.0',
        port=int(os.getenv('PORT', 5000)),
        debug=os.getenv('DEBUG', 'False').lower() == 'true'
    )