from flask import Flask, request, jsonify, send_from_directory
from manim import *
from manim import RegularPolygon
import ast
import subprocess
import os
import json
import tempfile
import shutil
import urllib.request
import wave
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
VOICES_DIR = Path(os.getenv('VOICES_DIR', '/app/voices'))

# Create directories
OUTPUT_DIR.mkdir(exist_ok=True, parents=True)
TEMP_DIR.mkdir(exist_ok=True, parents=True)
AUDIO_DIR.mkdir(exist_ok=True, parents=True)
VOICES_DIR.mkdir(exist_ok=True, parents=True)

# Default render quality. 'low' = 854x480@24fps (~3x faster than 'medium').
# Override via DEFAULT_RENDER_QUALITY env or by passing 'quality' in the request body.
DEFAULT_RENDER_QUALITY = os.getenv('DEFAULT_RENDER_QUALITY', 'low')

# ==========================================
# CLOUD STORAGE (Supabase)
# ==========================================
# When SUPABASE_SERVICE_ROLE_KEY is set, finished mp4/mp3 files are uploaded
# to a Supabase Storage bucket and the renderer returns the public URL. When
# unset (local dev), files stay on /app/output and /app/audio and the
# renderer returns relative `/videos/...` and `/audio/...` paths as before.
SUPABASE_URL = os.getenv('SUPABASE_URL', '').rstrip('/')
SUPABASE_SERVICE_ROLE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')
SUPABASE_BUCKET = os.getenv('SUPABASE_STORAGE_BUCKET', 'cognito-stream')
USE_CLOUD_STORAGE = bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)

_supabase_client = None

def _get_supabase():
    """Lazy-init the Supabase client. Only called when USE_CLOUD_STORAGE is True."""
    global _supabase_client
    if _supabase_client is None:
        from supabase import create_client
        _supabase_client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    return _supabase_client

def upload_to_storage(local_path, storage_path, content_type):
    """
    Upload a local file to Supabase Storage and return its public URL.
    If cloud storage isn't configured, returns None so the caller can fall
    back to a relative path.
    """
    if not USE_CLOUD_STORAGE:
        return None
    client = _get_supabase()
    # Remove any existing object first so re-renders overwrite cleanly.
    try:
        client.storage.from_(SUPABASE_BUCKET).remove([storage_path])
    except Exception:
        pass
    with open(local_path, 'rb') as fh:
        client.storage.from_(SUPABASE_BUCKET).upload(
            path=storage_path,
            file=fh.read(),
            file_options={'content-type': content_type, 'upsert': 'true'},
        )
    public_url = client.storage.from_(SUPABASE_BUCKET).get_public_url(storage_path)
    return public_url.rstrip('/')

def download_to_local(url_or_path, dest_dir):
    """
    Resolve a videoUrl/audioUrl to a local file path. If it's a full URL
    (starts with http), download it. If it's a relative path, treat it as
    living under /app/output or /app/audio. Returns the path on disk that
    ffmpeg can read.
    """
    if url_or_path.startswith('http://') or url_or_path.startswith('https://'):
        filename = url_or_path.rstrip('/').split('/')[-1].split('?')[0]
        local_path = Path(dest_dir) / filename
        with urllib.request.urlopen(url_or_path, timeout=60) as resp:
            local_path.write_bytes(resp.read())
        return str(local_path)
    # Relative path like /videos/foo.mp4 — strip the leading bucket prefix.
    if url_or_path.startswith('/videos/'):
        return str(OUTPUT_DIR / url_or_path[len('/videos/'):])
    if url_or_path.startswith('/audio/'):
        return str(AUDIO_DIR / url_or_path[len('/audio/'):])
    # Bare filename — try output dir first.
    return str(OUTPUT_DIR / url_or_path)

# Piper TTS voice — auto-downloaded on first request if not pre-baked into image.
# Voice name format: <locale>-<speaker>-<quality>, e.g. en_GB-jenny_dioco-medium.
# Browse voices: https://huggingface.co/rhasspy/piper-voices/tree/main
PIPER_VOICE = os.getenv('PIPER_VOICE', 'en_GB-jenny_dioco-medium')

def piper_voice_url(voice_name, filename):
    """Build the HuggingFace download URL for a Piper voice asset."""
    locale, speaker, quality = voice_name.split('-')
    lang = locale.split('_')[0]
    return (
        f'https://huggingface.co/rhasspy/piper-voices/resolve/main/'
        f'{lang}/{locale}/{speaker}/{quality}/{filename}'
    )

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
        
        # Find the rendered file - Manim puts files in nested directories
        possible_paths = [
            output_file,
            OUTPUT_DIR / 'videos' / f'{scene_id}.mp4',
            OUTPUT_DIR / 'videos' / str(scene_file.stem) / f'{scene_id}.mp4',
        ]
        
        # Also search for any mp4 files with our scene_id in the videos directory
        for mp4_file in OUTPUT_DIR.glob(f'**/*{scene_id}*.mp4'):
            if mp4_file not in possible_paths:
                possible_paths.append(mp4_file)
        
        # Also try to find any recently created mp4 file (within last 5 minutes)
        for mp4_file in OUTPUT_DIR.glob('**/*.mp4'):
            if mp4_file.stat().st_mtime > start_time - 10:  # Created after render started
                if mp4_file not in possible_paths:
                    possible_paths.append(mp4_file)
        
        logger.info(f"Searching for video in paths: {possible_paths}")
        
        for path in possible_paths:
            if path.exists():
                # Move to output directory if not already there
                if path != output_file:
                    shutil.move(str(path), str(output_file))
                logger.info(f"✓ Render complete: {output_file} ({render_time:.2f}s)")
                return output_file, render_time
        
        # Last resort - find ANY mp4 in the videos folder
        for mp4_file in list(OUTPUT_DIR.glob('**/*.mp4'))[:1]:
            logger.info(f"Found fallback video: {mp4_file}")
            shutil.move(str(mp4_file), str(output_file))
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

def concatenate_audio(audio_paths, output_path):
    """Concatenate multiple mp3 files into one using FFmpeg's concat demuxer.
    Re-encodes to libmp3lame because copy-mode can produce VBR-mismatched output."""

    logger.info(f"Concatenating {len(audio_paths)} audio files...")

    concat_file = TEMP_DIR / f'concat_audio_{int(time.time())}.txt'
    with open(concat_file, 'w') as f:
        for audio_path in audio_paths:
            abs_path = Path(audio_path).resolve()
            f.write(f"file '{abs_path}'\n")

    cmd = [
        'ffmpeg',
        '-f', 'concat',
        '-safe', '0',
        '-i', str(concat_file),
        '-c:a', 'libmp3lame',
        '-b:a', '128k',
        '-y',
        str(output_path),
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            raise Exception(f"FFmpeg audio concat error: {result.stderr}")
        concat_file.unlink(missing_ok=True)
        logger.info(f"✓ Audio concatenated successfully")
        return output_path
    except Exception as e:
        logger.error(f"Audio concatenation failed: {e}")
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
# PIPER TTS
# ==========================================

_piper_voice_cache = None  # Lazily loaded PiperVoice instance

def ensure_voice_model():
    """Download Piper voice model files if missing. Returns the .onnx path."""
    onnx_path = VOICES_DIR / f'{PIPER_VOICE}.onnx'
    json_path = VOICES_DIR / f'{PIPER_VOICE}.onnx.json'

    if not onnx_path.exists():
        logger.info(f"⬇️  Downloading Piper voice model: {PIPER_VOICE}.onnx (~30-100 MB)")
        urllib.request.urlretrieve(
            piper_voice_url(PIPER_VOICE, f'{PIPER_VOICE}.onnx'), onnx_path
        )
    if not json_path.exists():
        logger.info(f"⬇️  Downloading Piper voice config: {PIPER_VOICE}.onnx.json")
        urllib.request.urlretrieve(
            piper_voice_url(PIPER_VOICE, f'{PIPER_VOICE}.onnx.json'), json_path
        )

    return onnx_path

def get_piper_voice():
    """Load (and cache) the PiperVoice instance."""
    global _piper_voice_cache
    if _piper_voice_cache is None:
        from piper import PiperVoice
        onnx_path = ensure_voice_model()
        logger.info(f"🎤 Loading Piper voice: {onnx_path}")
        _piper_voice_cache = PiperVoice.load(str(onnx_path))
    return _piper_voice_cache

def synthesize_to_mp3(text, output_mp3):
    """Synthesize text → WAV via Piper, then convert to MP3 via FFmpeg."""
    voice = get_piper_voice()

    wav_path = TEMP_DIR / f'tts_{int(time.time() * 1000)}.wav'
    try:
        with wave.open(str(wav_path), 'wb') as wav_file:
            voice.synthesize(text, wav_file)

        # Convert WAV → MP3
        result = subprocess.run(
            [
                'ffmpeg', '-y',
                '-i', str(wav_path),
                '-codec:a', 'libmp3lame',
                '-qscale:a', '2',
                str(output_mp3),
            ],
            capture_output=True,
            timeout=60,
        )
        if result.returncode != 0:
            stderr = result.stderr.decode('utf-8', errors='replace')
            raise Exception(f"FFmpeg WAV→MP3 failed: {stderr[:300]}")
    finally:
        if wav_path.exists():
            try:
                wav_path.unlink()
            except Exception:
                pass

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
        quality = data.get('quality', DEFAULT_RENDER_QUALITY)
        
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

        # Per-scene videos stay on local disk; they are intermediates that get
        # concatenated by /assemble. Only the final stitched video is uploaded
        # to Supabase to keep bucket usage minimal.
        video_url = f'/videos/{scene_id}.mp4'

        return jsonify({
            'success': True,
            'videoUrl': video_url,
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

# ==========================================
# ERROR PARSING
# ==========================================

def parse_manim_errors(stderr, stdout):
    """Parse Manim error output into structured error info"""
    
    parsed_error_summary = None
    error_type = "UNKNOWN_ERROR"
    
    if not stderr:
        return None
    
    if "SyntaxError" in stderr:
        parsed_error_summary = "Manim rendering failed: Python syntax error in the generated code."
        error_type = "SYNTAX_ERROR"
    elif "NameError" in stderr:
        # Extract the name that wasn't found
        import re
        match = re.search(r"NameError: name '(\w+)' is not defined", stderr)
        name = match.group(1) if match else "unknown"
        parsed_error_summary = f"Manim rendering failed: '{name}' is not defined. Check imports and variable names."
        error_type = "NAME_ERROR"
    elif "TypeError" in stderr:
        parsed_error_summary = "Manim rendering failed: A function or method was called with wrong arguments."
        error_type = "TYPE_ERROR"
    elif "AttributeError" in stderr:
        import re
        match = re.search(r"AttributeError: '(\w+)' object has no attribute '(\w+)'", stderr)
        if match:
            parsed_error_summary = f"Manim rendering failed: '{match.group(1)}' has no attribute '{match.group(2)}'."
        else:
            parsed_error_summary = "Manim rendering failed: An attribute access failed."
        error_type = "ATTRIBUTE_ERROR"
    elif "ValueError" in stderr:
        parsed_error_summary = "Manim rendering failed: Invalid value passed to a function."
        error_type = "VALUE_ERROR"
    elif "ImportError" in stderr or "ModuleNotFoundError" in stderr:
        parsed_error_summary = "Manim rendering failed: A required module could not be imported."
        error_type = "IMPORT_ERROR"
    elif "ManimPangoCairoError" in stderr or "TEX" in stdout.upper():
        parsed_error_summary = "Manim rendering failed: Text rendering or LaTeX compilation error."
        error_type = "TEXT_RENDERING_ERROR"
    elif "FileNotFoundError" in stderr:
        parsed_error_summary = "Manim rendering failed: A required file was not found."
        error_type = "FILE_NOT_FOUND"
    elif "ZeroDivisionError" in stderr:
        parsed_error_summary = "Manim rendering failed: Division by zero in the animation code."
        error_type = "ZERO_DIVISION"
    
    if parsed_error_summary:
        return {"parsed_error": parsed_error_summary, "error_type": error_type}
    return None

# ==========================================
# ROUTE: Render full Python code
# ==========================================

@app.route('/render-code', methods=['POST'])
def render_full_code():
    """Render a scene from full Manim Python code (SculptAI-style pipeline)"""
    
    try:
        data = request.json
        scene_id = data.get('sceneId')
        manim_code = data.get('manimCode')
        quality = data.get('quality', DEFAULT_RENDER_QUALITY)
        
        if not scene_id or not manim_code:
            return jsonify({
                'success': False,
                'error': 'Missing required fields: sceneId and manimCode'
            }), 400
        
        if not isinstance(manim_code, str):
            return jsonify({
                'success': False,
                'error': 'manimCode must be a string containing full Python code'
            }), 400
        
        logger.info(f"🎬 Rendering full code for scene: {scene_id}")
        logger.info(f"Code length: {len(manim_code)} chars, Quality: {quality}")

        stats['total_renders'] += 1

        # --- Step 0: Fast Python AST parse ---
        # Catches syntax errors, indentation errors, truncated output, and
        # unbalanced brackets in microseconds. Saves a 30-90s Manim render
        # cycle whenever the LLM emitted broken Python. Error structure
        # matches LINT_ERROR so the orchestrator's correction loop reuses
        # the same path.
        try:
            ast.parse(manim_code)
        except SyntaxError as syntax_err:
            line_no = syntax_err.lineno or 0
            col_no = syntax_err.offset or 0
            err_msg = syntax_err.msg or 'Syntax error'
            # Pull the offending source line and a small context window so the
            # LLM has surrounding code to reason about during correction.
            code_lines = manim_code.splitlines()
            window_start = max(0, line_no - 3)
            window_end = min(len(code_lines), line_no + 2)
            context_lines = []
            for idx in range(window_start, window_end):
                marker = ' >>> ' if (idx + 1) == line_no else '     '
                context_lines.append(f"{marker}{idx + 1:4d}: {code_lines[idx]}")
            context = '\n'.join(context_lines)
            parsed = (
                f"SyntaxError at line {line_no}, col {col_no}: {err_msg}\n\n"
                f"Context:\n{context}"
            )
            logger.warning(f"❌ AST parse failed for scene {scene_id} at line {line_no}: {err_msg}")
            return jsonify({
                'success': False,
                'error': f'Syntax error in generated code: {err_msg} (line {line_no})',
                'lint_error': True,  # route through correction loop
                'details_stdout': parsed,
                'details_stderr': f'{type(syntax_err).__name__}: {err_msg} at line {line_no}, column {col_no}',
                'error_type': 'SYNTAX_ERROR',
                'parsed_error': parsed,
            }), 400
        except (ValueError, MemoryError, RecursionError) as parse_err:
            # Other parse-time failures (e.g., null bytes, deeply nested literals)
            logger.warning(f"❌ AST parse rejected scene {scene_id}: {parse_err}")
            return jsonify({
                'success': False,
                'error': f'Cannot parse generated code: {parse_err}',
                'lint_error': True,
                'details_stdout': str(parse_err),
                'details_stderr': f'{type(parse_err).__name__}: {parse_err}',
                'error_type': 'SYNTAX_ERROR',
                'parsed_error': f'Generated code could not be parsed: {parse_err}',
            }), 400

        # --- Step 1: Lint the code with flake8 ---
        temp_lint_file = None
        try:
            temp_lint_file = TEMP_DIR / f'lint_{scene_id}.py'
            with open(temp_lint_file, 'w', encoding='utf-8') as f:
                f.write(manim_code)
            
            lint_result = subprocess.run(
                ['flake8', '--select=F,E9', '--ignore=F403,F405', str(temp_lint_file)],
                capture_output=True,
                text=True,
                encoding='utf-8',
                timeout=30
            )
            
            if lint_result.returncode != 0:
                logger.warning(f"Linting failed for scene {scene_id}: {lint_result.stdout}")
                if temp_lint_file.exists():
                    temp_lint_file.unlink()
                return jsonify({
                    'success': False,
                    'error': 'Linting failed for the provided Manim code.',
                    'lint_error': True,
                    'details_stdout': lint_result.stdout,
                    'details_stderr': lint_result.stderr,
                    'error_type': 'LINT_ERROR',
                    'parsed_error': f'Code has syntax or import errors: {lint_result.stdout[:500]}'
                }), 400
            
            if temp_lint_file.exists():
                temp_lint_file.unlink()
                
        except Exception as lint_e:
            logger.error(f"Lint setup error for {scene_id}: {lint_e}")
            if temp_lint_file and temp_lint_file.exists():
                temp_lint_file.unlink()
            # Continue without linting — don't block rendering
        
        # --- Step 2: Write code and render with Manim ---
        quality_preset = QUALITY_PRESETS.get(quality, QUALITY_PRESETS['medium'])
        
        job_dir = TEMP_DIR / f'job_{scene_id}_{int(time.time())}'
        os.makedirs(job_dir, exist_ok=True)
        
        script_file = job_dir / 'scene_script.py'
        with open(script_file, 'w', encoding='utf-8') as f:
            f.write(manim_code)
        
        output_file = OUTPUT_DIR / f'{scene_id}.mp4'
        
        cmd = [
            'python', '-m', 'manim',
            str(script_file),
            'GeneratedScene',  # Expected class name from our prompt
            f'-q{quality_preset["quality"][0]}',
            '--format', 'mp4',
            '--media_dir', str(job_dir / 'media'),
            '-o', f'{scene_id}.mp4',
            '--disable_caching',
            '--progress_bar', 'none',
        ]
        
        logger.info(f"Executing: {' '.join(cmd)}")
        
        start_time = time.time()
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding='utf-8',
            timeout=300,
            cwd=str(job_dir)
        )
        
        render_time = time.time() - start_time
        
        if result.returncode != 0:
            logger.error(f"Manim render failed for {scene_id}: {result.stderr[:500]}")
            
            parsed = parse_manim_errors(result.stderr, result.stdout)
            response_payload = {
                'success': False,
                'error': 'Manim rendering failed.',
                'details_stdout': result.stdout,
                'details_stderr': result.stderr
            }
            if parsed:
                response_payload['parsed_error'] = parsed['parsed_error']
                response_payload['error_type'] = parsed['error_type']
            
            # Cleanup
            if job_dir.exists():
                shutil.rmtree(job_dir, ignore_errors=True)
            
            return jsonify(response_payload), 500
        
        # --- Step 3: Find the rendered video ---
        # Search for the output video in various locations
        possible_paths = [output_file]
        for mp4_file in job_dir.glob('**/*.mp4'):
            if mp4_file not in possible_paths:
                possible_paths.append(mp4_file)
        
        found_video = None
        for vpath in possible_paths:
            if vpath.exists():
                if vpath != output_file:
                    shutil.move(str(vpath), str(output_file))
                found_video = output_file
                break
        
        if not found_video:
            logger.error(f"Video not found after render for {scene_id}")
            if job_dir.exists():
                shutil.rmtree(job_dir, ignore_errors=True)
            return jsonify({
                'success': False,
                'error': 'Rendered video file not found.'
            }), 500
        
        # Get video info
        video_duration = get_video_duration(output_file)

        # Cleanup temp directory
        if job_dir.exists():
            shutil.rmtree(job_dir, ignore_errors=True)

        stats['successful_renders'] += 1
        stats['total_render_time'] += render_time

        logger.info(f"✓ Code render complete: {scene_id} ({render_time:.2f}s)")

        # Per-scene videos stay on local disk; only the final assembled video
        # is uploaded to Supabase by /assemble to keep bucket usage minimal.
        video_url = f'/videos/{scene_id}.mp4'

        return jsonify({
            'success': True,
            'videoUrl': video_url,
            'sceneId': scene_id,
            'duration': video_duration,
            'renderTime': round(render_time, 2)
        }), 200
        
    except subprocess.TimeoutExpired:
        logger.error(f"Render timed out for scene {scene_id}")
        stats['failed_renders'] += 1
        return jsonify({
            'success': False,
            'error': 'Manim rendering timed out (5 min limit).',
            'error_type': 'TIMEOUT'
        }), 504
    except Exception as e:
        logger.error(f"❌ Code render error: {str(e)}")
        logger.error(traceback.format_exc())
        stats['failed_renders'] += 1
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/assemble', methods=['POST'])
def assemble_video():
    """Assemble multiple scenes into final video, stitching audio per scene"""
    
    try:
        data = request.json
        storyboard_id = data.get('storyboardId')
        scenes = data.get('scenes', [])
        quality = data.get('quality', DEFAULT_RENDER_QUALITY)
        
        if not storyboard_id or not scenes:
            return jsonify({
                'success': False,
                'error': 'Missing required fields: storyboardId and scenes'
            }), 400
        
        logger.info(f"🎞️  Assembling video for: {storyboard_id}")
        logger.info(f"Scenes to assemble: {len(scenes)}")

        # Working dir for downloaded inputs and intermediate stitched files.
        work_dir = TEMP_DIR / f'assemble_{storyboard_id}_{int(time.time())}'
        work_dir.mkdir(parents=True, exist_ok=True)

        video_paths = []           # per-scene videos with audio stitched in
        per_scene_audio_paths = [] # per-scene narration mp3s, for the final voice track
        scene_local_files = []     # local intermediates to delete on success
        total_duration = 0

        try:
            for scene in scenes:
                video_url = scene.get('videoUrl', '')
                audio_url = scene.get('audioUrl', '')

                # Resolve videoUrl → local path (download if cloud URL).
                try:
                    video_path = Path(download_to_local(video_url, work_dir))
                except Exception as e:
                    logger.warning(f"Could not fetch video for scene {scene.get('sceneNumber')}: {e}")
                    continue
                if not video_path.exists():
                    logger.warning(f"Video not found after fetch: {video_path}")
                    continue
                # Track the per-scene mp4 in OUTPUT_DIR for cleanup after success.
                if video_url.startswith('/videos/'):
                    scene_local_files.append(OUTPUT_DIR / video_url[len('/videos/'):])

                # Stitch audio if provided.
                if audio_url:
                    try:
                        audio_path = Path(download_to_local(audio_url, work_dir))
                        if audio_path.exists():
                            stitched_path = work_dir / f"{video_path.stem}_with_audio.mp4"
                            stitch_audio_video(video_path, audio_path, stitched_path)
                            video_paths.append(stitched_path)
                            per_scene_audio_paths.append(audio_path)
                            logger.info(f"✓ Stitched audio into scene {scene.get('sceneNumber')}")
                        else:
                            logger.warning(f"Audio file missing after fetch: {audio_path}")
                            video_paths.append(video_path)
                    except Exception as stitch_err:
                        logger.error(f"Audio stitch failed for scene {scene.get('sceneNumber')}: {stitch_err}")
                        video_paths.append(video_path)
                    if audio_url.startswith('/audio/'):
                        scene_local_files.append(AUDIO_DIR / audio_url[len('/audio/'):])
                else:
                    video_paths.append(video_path)

                total_duration += scene.get('duration', 0)

            if not video_paths:
                return jsonify({
                    'success': False,
                    'error': 'No valid video files found'
                }), 400

            # Concat all stitched per-scene videos into the final mp4.
            output_file = work_dir / f'{storyboard_id}_final.mp4'
            concatenate_videos(video_paths, output_file)

            final_duration = get_video_duration(output_file)
            logger.info(f"✓ Final video assembled: {output_file}")
            logger.info(f"Total duration: {final_duration}s")

            # Persist final mp4 to OUTPUT_DIR and upload to Supabase.
            persistent_path = OUTPUT_DIR / f'{storyboard_id}_final.mp4'
            shutil.copy(str(output_file), str(persistent_path))

            public_url = upload_to_storage(
                local_path=str(persistent_path),
                storage_path=f'videos/{storyboard_id}_final.mp4',
                content_type='video/mp4',
            )
            video_url = public_url or f'/videos/{storyboard_id}_final.mp4'

            # Concatenate per-scene narration into a single final voice track
            # and upload as audio/<storyboardId>_final.mp3. Skip silently if
            # there were no per-scene audio files (edge case).
            audio_url = None
            if per_scene_audio_paths:
                try:
                    final_audio_local = work_dir / f'{storyboard_id}_final.mp3'
                    concatenate_audio(per_scene_audio_paths, final_audio_local)
                    persistent_audio = AUDIO_DIR / f'{storyboard_id}_final.mp3'
                    shutil.copy(str(final_audio_local), str(persistent_audio))

                    audio_public = upload_to_storage(
                        local_path=str(persistent_audio),
                        storage_path=f'audio/{storyboard_id}_final.mp3',
                        content_type='audio/mpeg',
                    )
                    audio_url = audio_public or f'/audio/{storyboard_id}_final.mp3'
                    logger.info(f"✓ Final voice track uploaded: {audio_url}")
                except Exception as audio_err:
                    logger.error(f"Final voice concat/upload failed: {audio_err}")

            # Final video is shipped — delete per-scene intermediates from
            # local disk so the bucket and the renderer disk only retain finals.
            for f in scene_local_files:
                try:
                    Path(f).unlink(missing_ok=True)
                except Exception as cleanup_err:
                    logger.warning(f"Failed to delete intermediate {f}: {cleanup_err}")
        finally:
            # Always clean up the working dir (downloads + stitched intermediates).
            shutil.rmtree(work_dir, ignore_errors=True)

        return jsonify({
            'success': True,
            'videoUrl': video_url,
            'audioUrl': audio_url,
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

@app.route('/audio/<path:filename>')
def serve_audio(filename):
    """Serve generated audio files"""
    return send_from_directory(AUDIO_DIR, filename)

@app.route('/tts', methods=['POST'])
def text_to_speech():
    """Generate audio from text using local Piper TTS"""

    try:
        data = request.json or {}
        scene_id = data.get('sceneId')
        text = data.get('text', '').strip()

        if not scene_id or not text:
            return jsonify({
                'success': False,
                'error': 'Missing required fields: sceneId and text'
            }), 400

        if len(text) > 5000:
            return jsonify({
                'success': False,
                'error': 'Text too long (max 5000 characters)'
            }), 400

        logger.info(f"🎙️  TTS request: scene={scene_id}, chars={len(text)}")

        start_time = time.time()
        mp3_path = AUDIO_DIR / f'{scene_id}.mp3'

        synthesize_to_mp3(text, mp3_path)

        duration = get_video_duration(mp3_path)  # ffprobe works on MP3 too
        elapsed = round(time.time() - start_time, 2)

        logger.info(f"✅ TTS complete: {mp3_path.name} ({duration}s, took {elapsed}s)")

        # Per-scene narration stays on local disk; only the final concatenated
        # voice track is uploaded to Supabase by /assemble.
        audio_url = f'/audio/{scene_id}.mp3'

        return jsonify({
            'success': True,
            'audioUrl': audio_url,
            'sceneId': scene_id,
            'duration': duration,
            'characterCount': len(text),
            'synthesisTime': elapsed,
        }), 200

    except Exception as e:
        logger.error(f"❌ TTS error: {e}")
        logger.error(traceback.format_exc())
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

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
    
    is_debug = os.getenv('DEBUG', 'False').lower() == 'true'

    app.run(
        host='0.0.0.0',
        port=int(os.getenv('PORT', 5000)),
        debug=is_debug,
        use_reloader=False  # Disable reloader — volume mounts handle code updates
    )