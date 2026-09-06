from flask import Flask, request, jsonify, send_from_directory
from manim import *
from manim import RegularPolygon
import ast
import subprocess
import os
import json
import re
import tempfile
import shutil
import urllib.request
import wave
from pathlib import Path
import logging
import threading
import traceback
from contextlib import contextmanager
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
# When SUPABASE_SERVICE_ROLE_KEY is set, two things are uploaded to the
# Supabase Storage bucket and the renderer returns their public URLs: the
# final stitched mp4 (narration already muxed in) and the small per-scene
# first-frame thumbnails the dashboard uses as posters. Nothing else — audio
# and per-scene videos are intermediates that stay on local disk, since the
# app has no way to read them from the bucket. When unset (local dev),
# everything stays on /app/output and /app/audio and the renderer returns
# relative `/videos/...` and `/audio/...` paths as before.
SUPABASE_URL = os.getenv('SUPABASE_URL', '').rstrip('/')
SUPABASE_SERVICE_ROLE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')
SUPABASE_BUCKET = os.getenv('SUPABASE_STORAGE_BUCKET', 'cognito-stream')
USE_CLOUD_STORAGE = bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)

# ==========================================
# ACCESS CONTROL
# ==========================================
#
# /render-code executes an arbitrary Python string. With no authentication and a
# publicly reachable Space that is remote code execution against a container
# holding SUPABASE_SERVICE_ROLE_KEY, which grants full read/write on the bucket.
# /assemble, /tts and /delete-final are equally sensitive (/delete-final can
# remove finished videos).
#
# Every request must carry X-Renderer-Token matching RENDERER_SHARED_SECRET.
#
# When the secret is UNSET the service still serves, loudly warning on startup
# and on each rejected-if-configured route. That is deliberate: the renderer and
# the API server deploy separately, so failing closed by default would guarantee
# an outage window for anyone who deploys the renderer before setting the
# variable. It is not "secure by default" — it is "does not break on deploy",
# and the warning says exactly that.
RENDERER_SHARED_SECRET = os.getenv('RENDERER_SHARED_SECRET', '')
AUTH_EXEMPT_PATHS = {'/health'}   # container healthcheck must work unauthenticated


@app.before_request
def _require_shared_secret():
    if request.path in AUTH_EXEMPT_PATHS or request.method == 'OPTIONS':
        return None
    if not RENDERER_SHARED_SECRET:
        return None
    supplied = request.headers.get('X-Renderer-Token', '')
    # compare_digest keeps the check constant-time.
    import hmac
    if not hmac.compare_digest(supplied, RENDERER_SHARED_SECRET):
        logger.warning(
            f"Rejected unauthenticated {request.method} {request.path} "
            f"from {request.remote_addr}"
        )
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    return None


# ==========================================
# RENDER CONCURRENCY
# ==========================================
#
# SCENE_CONCURRENCY on the API server limits scenes PER STORYBOARD. It cannot
# limit anything across storyboards, so two users generating at once ran 4
# concurrent Manim processes and five users ran 10 — on a 2 vCPU Space. Manim is
# CPU-bound and memory-hungry; that is how this service falls over.
#
# Requests QUEUE rather than fail: a caller that waits 40s for a slot still gets
# its video, whereas a 503 turns into a failed scene and an LLM repair call for
# an error the model cannot fix.
MAX_CONCURRENT_RENDERS = int(os.getenv('MAX_CONCURRENT_RENDERS', '0')) or (os.cpu_count() or 2)
# Below the API server's 300s per-render timeout, so a queued request gives up
# and reports honestly rather than having the connection cut from under it.
RENDER_QUEUE_TIMEOUT = int(os.getenv('RENDER_QUEUE_TIMEOUT', '240'))
_render_slots = threading.BoundedSemaphore(MAX_CONCURRENT_RENDERS)


@contextmanager
def render_slot(label):
    """Hold one of the renderer's CPU slots, queueing if all are busy."""
    waited = time.time()
    if not _render_slots.acquire(timeout=RENDER_QUEUE_TIMEOUT):
        raise TimeoutError(
            f'renderer busy: no slot within {RENDER_QUEUE_TIMEOUT}s '
            f'({MAX_CONCURRENT_RENDERS} concurrent renders max)'
        )
    queued = time.time() - waited
    if queued > 1.0:
        logger.info(f"{label}: waited {queued:.1f}s for a render slot")
    try:
        yield
    finally:
        _render_slots.release()


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

def _slugify(text, max_len=60):
    """Convert title text to a URL-safe slug. Returns empty string if text
    has no slug-able characters (rare — e.g. all emoji)."""
    if not text:
        return ''
    s = re.sub(r'[^\w\s-]', '', str(text).lower(), flags=re.UNICODE)
    s = re.sub(r'[-\s]+', '-', s).strip('-')
    return s[:max_len].rstrip('-')

def build_storage_path(prefix, storyboard_id, title, ext):
    """Build a Supabase storage path that is human-readable AND unique.

    Format: <prefix>/<slug>-<short_id><ext>
        e.g. videos/explain-merge-sort-3gl8w0.mp4

    The 6-char suffix from storyboard_id prevents two storyboards with the
    same title from overwriting each other in the bucket. Falls back to the
    legacy `<storyboard_id>_final<ext>` path when the title is empty or
    contains no slug-able characters.
    """
    slug = _slugify(title)
    short = (storyboard_id or '')[-6:].lower()
    if slug:
        return f'{prefix}/{slug}-{short}{ext}'
    return f'{prefix}/{storyboard_id}_final{ext}'

def download_to_local(url_or_path, dest_dir):
    """
    Resolve a videoUrl/audioUrl to a local file path. If it's a full URL
    (starts with http), download it. If it's a relative path, treat it as
    living under /app/output or /app/audio. Returns the path on disk that
    ffmpeg can read.
    """
    if url_or_path.startswith('http://') or url_or_path.startswith('https://'):
        filename = url_or_path.rstrip('/').split('/')[-1].split('?')[0]
        # Fast path: this container may still hold the file it uploaded. Scene
        # ids are unique, so a name match here is the same object. Saves
        # re-downloading ~1.5 MB per scene on every assemble.
        for cached in (OUTPUT_DIR / filename, AUDIO_DIR / filename):
            if cached.exists() and cached.stat().st_size > 0:
                logger.info(f"Using local copy of {filename} (skipping download)")
                return str(cached)
        local_path = Path(dest_dir) / filename
        with urllib.request.urlopen(url_or_path, timeout=120) as resp:
            local_path.write_bytes(resp.read())
        logger.info(f"Downloaded {filename} from storage")
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
# Maps our quality name to Manim's own preset. ONLY the 'quality' value is
# used — its first letter becomes the -q flag, and Manim decides resolution and
# frame rate from that.
#
# The resolution/fps/bitrate keys that used to sit here were dead: nothing read
# them, so 'bitrate': '2500k' was never passed to any encoder and the declared
# fps disagreed with what Manim actually produced. Verified values are in the
# comments below so the mapping is not guesswork.
QUALITY_PRESETS = {
    'low':    {'quality': 'low_quality'},         # 854x480  @15fps
    'medium': {'quality': 'medium_quality'},      # 1280x720 @30fps
    'high':   {'quality': 'high_quality'},        # 1920x1080 @60fps
    'ultra':  {'quality': 'production_quality'},  # 2560x1440 @60fps
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
        
        # Same discipline as /render-code: only files produced BY THIS RENDER
        # count. This path previously listed the destination first (returning a
        # stale mp4 from an earlier render of the same scene) and then, failing
        # that, moved ANY mp4 found anywhere under OUTPUT_DIR into place — which
        # could hand back a completely unrelated scene's video.
        candidates = [
            m for m in OUTPUT_DIR.glob('**/*.mp4')
            if 'partial_movie_files' not in m.parts
            and m != output_file
            and m.stat().st_mtime >= start_time
        ]
        candidates.sort(key=lambda m: (m.name != f'{scene_id}.mp4', -m.stat().st_mtime))

        if not candidates:
            raise Exception("Rendered video file not found")

        output_file.unlink(missing_ok=True)
        shutil.move(str(candidates[0]), str(output_file))
        logger.info(f"✓ Render complete: {output_file} ({render_time:.2f}s)")
        return output_file, render_time
        
    except subprocess.TimeoutExpired:
        raise Exception("Rendering timeout exceeded (5 minutes)")
    except Exception as e:
        logger.error(f"Rendering failed: {e}")
        raise

def stitch_audio_video(video_path, audio_path, output_path):
    """Combine video and audio, keeping BOTH streams whole.

    Output length is max(video, audio):

      * Narration longer than the animation -> the last video frame is held
        (cloned) until the audio finishes, so narration always plays in full.
      * Animation longer than the narration -> the audio is padded with
        silence, so the animation always plays in full.

    The second case used to be a hard cut at the audio length, which
    truncated the animation mid-motion with no error and no log line. Both
    directions are now symmetric, and the size of the gap is minimised
    upstream by generating the narration first and building the animation to
    fit its measured duration (see server/src/lib/narrationTiming.ts).
    """

    video_duration = float(get_video_duration(video_path))
    audio_duration = float(get_video_duration(audio_path))

    # Fall back conservatively if probing failed for either stream — better to
    # over-run and pad than to silently cut content.
    if audio_duration <= 0:
        logger.warning("Could not probe audio duration; assuming 60s")
        audio_duration = 60.0
    if video_duration <= 0:
        logger.warning("Could not probe video duration; deferring to audio length")
        video_duration = audio_duration

    target = max(video_duration, audio_duration)
    gap = abs(video_duration - audio_duration)
    longer = "video" if video_duration > audio_duration else "audio"
    logger.info(
        f"Stitching: video={video_duration:.2f}s audio={audio_duration:.2f}s "
        f"-> output={target:.2f}s ({longer} longer by {gap:.2f}s)"
    )
    # A large mismatch means the timing budget did not land. Not fatal — the
    # padding below keeps the scene watchable — but worth surfacing, since a
    # persistent skew here points at the code-gen prompt rather than FFmpeg.
    if gap > max(3.0, 0.35 * target):
        logger.warning(
            f"Large A/V mismatch ({gap:.2f}s over a {target:.2f}s scene) — "
            f"{longer} overruns; check the scene's timing budget."
        )

    # Pad BOTH streams past the target, then cut both at it. We do NOT rely on
    # `-shortest`, whose interaction with `tpad` has produced incorrect output
    # durations in practice; an explicit `-t` is deterministic.
    cmd = [
        'ffmpeg',
        '-i', str(video_path),
        '-i', str(audio_path),
        '-vf', f'tpad=stop_mode=clone:stop_duration={target + 0.5}',
        '-af', f'apad=pad_dur={target + 0.5}',
        '-c:v', 'libx264',
        # Every scene is encoded TWICE: once by Manim, then again here when the
        # narration is muxed in. crf 23 / preset fast measured SSIM 0.998885
        # against the Manim original; crf 18 / preset slow measured 0.999524 in
        # the SAME 0.4s, so the sharper setting is effectively free — the only
        # cost is file size, which is trivial next to what pruning scene files
        # already saves.
        '-preset', 'slow',
        '-crf', '18',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '192k',
        # Sample rate and channel count are pinned, not inherited from the mp3.
        # concat -c copy requires every input to agree on these exactly, and
        # Piper's output rate is not guaranteed to match the silent track we
        # synthesise for scenes that have no narration.
        '-ar', '44100',
        '-ac', '2',
        '-t', f'{target:.3f}',
        '-y',
        str(output_path),
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            raise Exception(f"FFmpeg error: {result.stderr}")
        logger.info(f"✓ Audio stitched successfully (output={target:.2f}s)")
        return output_path
    except Exception as e:
        logger.error(f"Audio stitching failed: {e}")
        raise

def ensure_audio_track(video_path, output_path):
    """Re-encode a video that has no audio so it matches the stitched scenes.

    The final concat uses the concat demuxer with `-c copy`, which requires
    every input to have the SAME stream layout. Scenes with narration come out
    of stitch_audio_video as h264 + aac; a scene whose narration was missing or
    whose stitch failed was previously appended as the raw Manim mp4 — video
    only. Concatenating one-stream and two-stream files together is exactly the
    case `-c copy` cannot handle, and it needs only a single TTS failure to
    occur, in a pipeline that deliberately treats TTS failure as non-fatal.

    Adding silence costs one re-encode of a scene that had no audio anyway, and
    keeps the fast copy-mode concat viable for everything else.
    """
    cmd = [
        'ffmpeg',
        '-i', str(video_path),
        '-f', 'lavfi',
        '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
        '-c:v', 'libx264',
        # Matches stitch_audio_video exactly — a narration-less scene must not
        # be visibly softer than its neighbours.
        '-preset', 'slow',
        '-crf', '18',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ar', '44100',
        '-ac', '2',
        '-shortest',
        '-y',
        str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise Exception(f"FFmpeg silent-track error: {result.stderr[-400:]}")
    logger.info(f"\u2713 Added silent audio track to {Path(video_path).name}")
    return output_path


def has_audio_stream(video_path):
    """True when the file carries at least one audio stream."""
    cmd = [
        'ffprobe', '-v', 'error',
        '-select_streams', 'a',
        '-show_entries', 'stream=codec_type',
        '-of', 'csv=p=0',
        str(video_path),
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        return 'audio' in (r.stdout or '')
    except Exception as e:
        # Unknown means "assume it needs normalising" — a needless re-encode is
        # far cheaper than a corrupt final video.
        logger.warning(f"Could not probe audio streams for {video_path}: {e}")
        return False


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
    
    def run(mode):
        if mode == 'copy':
            codec = ['-c', 'copy']
        else:
            # Last resort: re-encode everything to one canonical format. Slower,
            # but it cannot be defeated by a stream-layout mismatch.
            codec = [
                '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
                '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2',
            ]
        cmd = ['ffmpeg', '-f', 'concat', '-safe', '0', '-i', str(concat_file),
               *codec, '-y', str(output_path)]
        return subprocess.run(cmd, capture_output=True, text=True, timeout=300)

    try:
        # Stream copy first: it is near-instant and correct whenever every
        # input already shares a layout, which ensure_audio_track guarantees.
        result = run('copy')

        if result.returncode != 0:
            # Do not fail the video here. A mismatch that slipped past
            # normalisation is recoverable by re-encoding, and losing the whole
            # render to a codec detail is the worse outcome by far.
            logger.warning(
                f"Concat with -c copy failed ({result.stderr.strip()[-300:]}) — "
                "retrying with a full re-encode."
            )
            result = run('reencode')
            if result.returncode != 0:
                raise Exception(f"FFmpeg concat error: {result.stderr}")
            logger.info("\u2713 Videos concatenated (re-encoded)")
        else:
            logger.info("\u2713 Videos concatenated successfully")

        concat_file.unlink(missing_ok=True)
        return output_path

    except Exception as e:
        logger.error(f"Video concatenation failed: {e}")
        concat_file.unlink(missing_ok=True)
        raise

def extract_thumbnail(video_path, output_path, width=480):
    """Extract the first frame of a video as a JPEG thumbnail. Used to give
    each scene a visual poster in the dashboard. ~10 KB at 480x270."""
    cmd = [
        'ffmpeg',
        '-y',
        '-ss', '0',
        '-i', str(video_path),
        '-frames:v', '1',
        '-vf', f'scale={width}:-2',
        '-q:v', '5',
        str(output_path),
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            raise Exception(f"FFmpeg thumbnail error: {result.stderr[:200]}")
        return output_path
    except Exception as e:
        logger.warning(f"Thumbnail extraction failed: {e}")
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
        # Whether SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are both present.
        # When false, finished videos are NOT uploaded — the renderer returns
        # relative `/videos/...` paths that only resolve on its own disk, so
        # the DB ends up storing a link that 404s from anywhere else. Exposed
        # here (no secrets, just the boolean + bucket name) so a deploy can be
        # verified without shell access to the container.
        'cloud_storage': USE_CLOUD_STORAGE,
        'storage_bucket': SUPABASE_BUCKET if USE_CLOUD_STORAGE else None,
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

        # Queue behind the global slot limit. Only the Manim subprocess is held:
        # the AST parse, lint and uploads around it are cheap and must not
        # occupy a CPU slot other renders are waiting on.
        try:
            with render_slot(f'scene {scene_id}'):
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    encoding='utf-8',
                    timeout=300,
                    cwd=str(job_dir)
                )
        except TimeoutError as busy:
            logger.error(f"{scene_id}: {busy}")
            if job_dir.exists():
                shutil.rmtree(job_dir, ignore_errors=True)
            stats['failed_renders'] += 1
            return jsonify({
                'success': False,
                'error': str(busy),
                # Not a code fault — flagged so the caller does not spend an LLM
                # repair call trying to fix a queue.
                'error_type': 'RENDERER_BUSY',
            }), 503

        render_time = time.time() - start_time
        
        if result.returncode != 0:
            logger.error(f"Manim render failed for {scene_id}: {result.stderr[:500]}")
            # Counted here too. Only exceptions were tallied before, so the
            # single most common failure — Manim exiting non-zero on bad code —
            # never appeared in /stats, making the success rate read far higher
            # than it was.
            stats['failed_renders'] += 1

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
        #
        # Search ONLY inside job_dir. `output_file` is the DESTINATION for this
        # render, not a place Manim ever writes to (--media_dir points at
        # job_dir/media), so it must never be a search candidate.
        #
        # It used to be the FIRST candidate, which meant a leftover mp4 from an
        # earlier render of the same scene short-circuited the search: the fresh
        # render was deleted along with job_dir and the stale file was returned
        # as this run's output, along with its duration and thumbnail. Every
        # re-render of a scene silently served the previous video, which is why
        # editing code and re-rendering could appear to do nothing.
        #
        # partial_movie_files/ holds Manim's per-animation fragments. The old
        # glob matched those too, in arbitrary order, so a fragment could be
        # picked instead of the finished scene.
        candidates = [
            m for m in job_dir.glob('**/*.mp4')
            if 'partial_movie_files' not in m.parts
        ]
        # `-o {scene_id}.mp4` names the finished render; prefer it, then fall
        # back to the newest remaining file.
        candidates.sort(key=lambda m: (m.name != f'{scene_id}.mp4', -m.stat().st_mtime))

        if not candidates:
            logger.error(f"Video not found after render for {scene_id}")
            if job_dir.exists():
                shutil.rmtree(job_dir, ignore_errors=True)
            # Deliberately does NOT fall back to a previous render of this
            # scene. Reporting failure lets the correction loop do its job;
            # silently returning last time's video does not.
            return jsonify({
                'success': False,
                'error': 'Rendered video file not found.'
            }), 500

        # Replace any previous render of this scene. Only reached on success, so
        # a failed re-render leaves the earlier file untouched rather than
        # destroying a good video.
        output_file.unlink(missing_ok=True)
        shutil.move(str(candidates[0]), str(output_file))
        found_video = output_file
        logger.info(f"Rendered scene file: {candidates[0].name} -> {output_file.name}")
        
        # Get video info
        video_duration = get_video_duration(output_file)

        # Cleanup temp directory
        if job_dir.exists():
            shutil.rmtree(job_dir, ignore_errors=True)

        stats['successful_renders'] += 1
        stats['total_render_time'] += render_time

        logger.info(f"✓ Code render complete: {scene_id} ({render_time:.2f}s)")

        # Per-scene videos are uploaded, not just kept on local disk.
        #
        # This container's filesystem is ephemeral — a Space restart, sleep or
        # rebuild wipes /app/output. The database stores scene.videoUrl as a
        # durable pointer, so a local-only path became a dangling reference the
        # moment that happened: re-assembling then silently dropped every scene
        # whose file had vanished, and the dashboard's per-scene previews 404'd.
        #
        # The local copy is KEPT as well, so assembly in the same session still
        # reads from disk (see download_to_local) and only pays the download
        # when the file is genuinely gone.
        scene_public_url = None
        try:
            scene_public_url = upload_to_storage(
                local_path=str(output_file),
                storage_path=f'scenes/{scene_id}.mp4',
                content_type='video/mp4',
            )
        except Exception as up_err:
            logger.warning(
                f"Scene video upload failed for {scene_id}: {up_err} — "
                "falling back to the local path, which will not survive a restart."
            )
        video_url = scene_public_url or f'/videos/{scene_id}.mp4'

        # Extract first-frame thumbnail and upload to Supabase. ~10 KB per
        # scene; gives the dashboard a real poster image instead of an icon.
        thumbnail_url = None
        try:
            thumb_local = OUTPUT_DIR / f'{scene_id}_thumb.jpg'
            extract_thumbnail(output_file, thumb_local, width=480)
            thumb_public = upload_to_storage(
                local_path=str(thumb_local),
                storage_path=f'thumbnails/{scene_id}.jpg',
                content_type='image/jpeg',
            )
            thumbnail_url = thumb_public  # None when Supabase isn't configured
            # Local file no longer needed; stays in OUTPUT_DIR for now and is
            # cleaned up alongside the per-scene mp4 by /assemble.
        except Exception as thumb_err:
            logger.warning(f"Thumbnail step skipped for {scene_id}: {thumb_err}")

        return jsonify({
            'success': True,
            'videoUrl': video_url,
            'thumbnailUrl': thumbnail_url,
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
        title = data.get('title', '')
        scenes = data.get('scenes', [])
        quality = data.get('quality', DEFAULT_RENDER_QUALITY)

        if not storyboard_id or not scenes:
            return jsonify({
                'success': False,
                'error': 'Missing required fields: storyboardId and scenes'
            }), 400

        logger.info(f"🎞️  Assembling video for: {storyboard_id} (title='{title}')")
        logger.info(f"Scenes to assemble: {len(scenes)}")

        # Working dir for downloaded inputs and intermediate stitched files.
        work_dir = TEMP_DIR / f'assemble_{storyboard_id}_{int(time.time())}'
        work_dir.mkdir(parents=True, exist_ok=True)

        video_paths = []           # per-scene videos with audio stitched in
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
                    base = video_url[len('/videos/'):]
                    scene_local_files.append(OUTPUT_DIR / base)
                    # Thumbnail jpg lives next to the mp4: <sceneId>_thumb.jpg
                    stem = Path(base).stem
                    scene_local_files.append(OUTPUT_DIR / f'{stem}_thumb.jpg')

                # Append a scene that has no usable narration, normalised so it
                # carries the same h264 + aac layout as the stitched scenes.
                # Appending the raw Manim mp4 here (video only) is what used to
                # break the final concat.
                def append_silent(reason):
                    silent_path = work_dir / f"{video_path.stem}_silent.mp4"
                    try:
                        ensure_audio_track(video_path, silent_path)
                        video_paths.append(silent_path)
                    except Exception as norm_err:
                        logger.error(
                            f"Could not add a silent track to scene "
                            f"{scene.get('sceneNumber')}: {norm_err} — appending as-is; "
                            "the concat will fall back to re-encoding."
                        )
                        video_paths.append(video_path)
                    logger.warning(
                        f"Scene {scene.get('sceneNumber')} has no narration ({reason}) "
                        "— using a silent track."
                    )

                # Stitch audio if provided.
                if audio_url:
                    try:
                        audio_path = Path(download_to_local(audio_url, work_dir))
                        if audio_path.exists():
                            stitched_path = work_dir / f"{video_path.stem}_with_audio.mp4"
                            stitch_audio_video(video_path, audio_path, stitched_path)
                            video_paths.append(stitched_path)
                            logger.info(f"✓ Stitched audio into scene {scene.get('sceneNumber')}")
                        else:
                            append_silent('audio file missing after fetch')
                    except Exception as stitch_err:
                        logger.error(f"Audio stitch failed for scene {scene.get('sceneNumber')}: {stitch_err}")
                        append_silent('stitch failed')
                    if audio_url.startswith('/audio/'):
                        scene_local_files.append(AUDIO_DIR / audio_url[len('/audio/'):])
                elif has_audio_stream(video_path):
                    # Already carries audio somehow — leave it alone.
                    video_paths.append(video_path)
                else:
                    append_silent('no audioUrl on the scene')

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

            video_storage_path = build_storage_path('videos', storyboard_id, title, '.mp4')
            public_url = upload_to_storage(
                local_path=str(persistent_path),
                storage_path=video_storage_path,
                content_type='video/mp4',
            )
            video_url = public_url or f'/videos/{storyboard_id}_final.mp4'
            if public_url:
                logger.info(f"✓ Final video uploaded to bucket: {video_storage_path}")
            else:
                logger.info("✓ Final video stored locally (no cloud storage configured)")

            # NOTE: a concatenated <storyboardId>_final.mp3 used to be built here
            # and written to AUDIO_DIR. Removed — it was pure waste: the same
            # narration is already muxed into the final mp4, the assemble
            # response's audio field is not persisted (AssembleResult in
            # services/renderer.ts has no audioUrl), there is no finalAudioUrl
            # column, and nothing ever deleted the file. Every assembly left one
            # behind on an ephemeral disk, plus an ffmpeg re-encode nobody used.
            audio_url = None

            # Storage policy:
            #   per-scene mp4s -> stay on local disk
            #   final mp4      -> bucket, then the local copy is dropped
            #
            # The per-scene files used to be deleted here, which made the final
            # video a one-shot artifact: once it shipped, its inputs were gone,
            # so re-assembling after a scene was retried silently produced a
            # video containing only the scenes that happened to still exist.
            # They are the durable inputs to every future rebuild, so they stay.
            #
            # The final mp4 is the opposite: once it is in the bucket, the local
            # copy is a duplicate. Deleted only when the upload actually
            # succeeded — with no cloud storage configured (local dev), that
            # file is the only copy of the video and must be kept.
            if public_url:
                try:
                    persistent_path.unlink(missing_ok=True)
                    logger.info(
                        f"🗑️  Local final removed (now served from bucket): {persistent_path.name}"
                    )
                except Exception as cleanup_err:
                    logger.warning(f"Could not remove local final: {cleanup_err}")
            else:
                logger.info(
                    f"✓ Final kept locally (cloud storage not configured): {persistent_path.name}"
                )

            logger.info(
                f"📦 Retained {len(scene_local_files)} per-scene file(s) for future rebuilds"
            )
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

        # Uploaded for the same reason as the scene video: scene.audioUrl is
        # stored in the database as a durable pointer, and this disk is not.
        # Without it, a restart between narration and render meant assembly
        # found no audio and stitched the scene silent.
        audio_public_url = None
        try:
            audio_public_url = upload_to_storage(
                local_path=str(mp3_path),
                storage_path=f'audio/{scene_id}.mp3',
                content_type='audio/mpeg',
            )
        except Exception as up_err:
            logger.warning(
                f"Scene audio upload failed for {scene_id}: {up_err} — "
                "falling back to the local path, which will not survive a restart."
            )
        audio_url = audio_public_url or f'/audio/{scene_id}.mp3'

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

def _storage_path_from_url(url):
    """Map a Supabase public URL back to the object path inside the bucket.

    Public URLs look like:
      https://<proj>.supabase.co/storage/v1/object/public/<bucket>/videos/foo.mp4

    Returns None for a relative/local URL or a URL from another bucket.
    """
    if not url:
        return None
    marker = f'/storage/v1/object/public/{SUPABASE_BUCKET}/'
    idx = str(url).find(marker)
    if idx == -1:
        return None
    return str(url)[idx + len(marker):].split('?')[0]


def _local_path_from_url(url):
    """Map a relative /videos/... or /audio/... URL to its file on disk."""
    if not url:
        return None
    url = str(url).split('?')[0]
    if url.startswith('/videos/'):
        return OUTPUT_DIR / url[len('/videos/'):]
    if url.startswith('/audio/'):
        return AUDIO_DIR / url[len('/audio/'):]
    return None


@app.route('/delete-final', methods=['POST'])
def delete_final():
    """Delete a storyboard's previously assembled final video / audio.

    Called before re-assembling after a scene was retried. Upload already
    overwrites an object at the SAME path, but the path is derived from the
    storyboard title (videos/<slug>-<short-id>.mp4) — so once a title changes,
    a rebuild lands on a new path and the old file is orphaned in the bucket
    forever. Deleting by the URL actually recorded in the database removes the
    object that exists rather than the one we would compute today.

    Missing files are not an error: this runs on a best-effort cleanup path and
    must never block the rebuild that follows it.
    """
    try:
        data = request.json or {}
        # `urls` is the general form, used when a storyboard is deleted and
        # every per-scene object has to go with it. videoUrl/audioUrl are kept
        # for the rebuild path that predates it.
        extra = data.get('urls') or []
        if not isinstance(extra, list):
            extra = []
        urls = [u for u in (data.get('videoUrl'), data.get('audioUrl'), *extra) if u]
        # De-duplicate but keep order: scenes can legitimately share a URL, and
        # removing the same object twice reports a spurious failure.
        urls = list(dict.fromkeys(urls))

        deleted, missing, failed = [], [], []

        for url in urls:
            storage_path = _storage_path_from_url(url)
            if storage_path and USE_CLOUD_STORAGE:
                try:
                    _get_supabase().storage.from_(SUPABASE_BUCKET).remove([storage_path])
                    deleted.append(storage_path)
                    logger.info(f"🗑️  Deleted from bucket: {storage_path}")
                except Exception as e:
                    failed.append({'path': storage_path, 'error': str(e)[:200]})
                    logger.warning(f"⚠️  Could not delete {storage_path}: {e}")
                # Remove the local twin too. Uploading keeps a copy on disk so
                # same-session assembly can skip the download, so deleting only
                # the bucket object would leave that copy behind forever —
                # exactly the disk growth this cleanup exists to avoid.
                basename = storage_path.split('/')[-1]
                twins = [OUTPUT_DIR / basename, AUDIO_DIR / basename]
                # The thumbnail is the one object whose local name differs from
                # its storage name: uploaded as thumbnails/<sceneId>.jpg but
                # written to disk as <sceneId>_thumb.jpg by extract_thumbnail.
                # Matching on the basename alone therefore never finds it, and
                # a ~10 KB jpg per scene was left behind on every cleanup.
                if storage_path.startswith('thumbnails/'):
                    twins.append(OUTPUT_DIR / f'{Path(basename).stem}_thumb.jpg')
                for twin in twins:
                    try:
                        if twin.exists():
                            twin.unlink()
                            deleted.append(str(twin))
                            logger.info(f"🗑️  Deleted local twin: {twin.name}")
                    except Exception as e:
                        failed.append({'path': str(twin), 'error': str(e)[:200]})
                continue

            local_path = _local_path_from_url(url)
            if local_path is not None:
                try:
                    if local_path.exists():
                        local_path.unlink()
                        deleted.append(str(local_path))
                        logger.info(f"🗑️  Deleted local file: {local_path}")
                    else:
                        missing.append(str(local_path))
                except Exception as e:
                    failed.append({'path': str(local_path), 'error': str(e)[:200]})
                continue

            missing.append(str(url))

        return jsonify({
            'success': True,
            'deleted': deleted,
            'missing': missing,
            'failed': failed,
        }), 200

    except Exception as e:
        logger.error(f"delete-final failed: {e}")
        return jsonify({'success': False, 'error': str(e)[:300]}), 500


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
    # Stated explicitly at startup because the failure is otherwise silent:
    # with no credentials, upload_to_storage returns None and every scene and
    # final video falls back to a container-local path that does not survive a
    # restart — and nothing says so until the files are already gone.
    logger.info(
        f"Render concurrency: {MAX_CONCURRENT_RENDERS} "
        f"(queue timeout {RENDER_QUEUE_TIMEOUT}s)"
    )
    if RENDERER_SHARED_SECRET:
        logger.info("Auth: ENABLED (X-Renderer-Token required)")
    else:
        logger.warning(
            "Auth: DISABLED — RENDERER_SHARED_SECRET is not set. /render-code "
            "executes arbitrary Python, so anyone who can reach this service can "
            "run code in this container and read SUPABASE_SERVICE_ROLE_KEY. Set "
            "the variable here AND on the API server to close it."
        )
    if USE_CLOUD_STORAGE:
        logger.info(f"Cloud storage: ENABLED -> bucket '{SUPABASE_BUCKET}'")
    else:
        logger.warning(
            "Cloud storage: DISABLED (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY "
            "not set). Scene and final videos stay on local disk only and will "
            "be lost when this container restarts."
        )
    logger.info("Starting server...")
    
    is_debug = os.getenv('DEBUG', 'False').lower() == 'true'

    app.run(
        host='0.0.0.0',
        port=int(os.getenv('PORT', 5000)),
        debug=is_debug,
        use_reloader=False  # Disable reloader — volume mounts handle code updates
    )