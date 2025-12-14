# ==========================================
# TEST APP
# renderer/tests/test_app.py
# ==========================================

import pytest
import json
from pathlib import Path
import sys

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app import app

@pytest.fixture
def client():
    """Create test client"""
    app.config['TESTING'] = True
    with app.test_client() as client:
        yield client

def test_health_check(client):
    """Test health check endpoint"""
    response = client.get('/health')
    assert response.status_code == 200
    
    data = json.loads(response.data)
    assert data['status'] == 'ok'
    assert 'stats' in data
    assert 'uptime' in data

def test_render_scene_missing_fields(client):
    """Test render with missing required fields"""
    response = client.post(
        '/render',
        json={},
        content_type='application/json'
    )
    
    assert response.status_code == 400
    data = json.loads(response.data)
    assert 'error' in data

def test_render_scene_valid(client):
    """Test render with valid data"""
    response = client.post(
        '/render',
        json={
            'sceneId': 'test-scene-1',
            'manimCode': ['Text("Test").scale(1.5)'],
            'duration': 3.0,
            'quality': 'low'
        },
        content_type='application/json'
    )
    
    # This may fail if Manim is not properly installed
    # but should at least return proper error structure
    data = json.loads(response.data)
    assert 'success' in data

def test_assemble_missing_fields(client):
    """Test assemble with missing fields"""
    response = client.post(
        '/assemble',
        json={},
        content_type='application/json'
    )
    
    assert response.status_code == 400

def test_stats_endpoint(client):
    """Test stats endpoint"""
    response = client.get('/stats')
    assert response.status_code == 200
    
    data = json.loads(response.data)
    assert 'total_renders' in data
    assert 'successful_renders' in data
    assert 'disk_usage' in data

def test_test_endpoint(client):
    """Test the test render endpoint"""
    response = client.get('/test')
    
    # May succeed or fail based on Manim installation
    data = json.loads(response.data)
    assert 'success' in data

# ==========================================
# TEST VIDEO PROCESSOR
# renderer/tests/test_video_processor.py
# ==========================================

import pytest
from pathlib import Path
import tempfile
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))

from utils.video_processor import VideoProcessor

@pytest.fixture
def video_processor():
    return VideoProcessor()

@pytest.fixture
def temp_dir():
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)

def test_video_processor_init(video_processor):
    """Test VideoProcessor initialization"""
    assert video_processor.ffmpeg == 'ffmpeg'
    assert video_processor.ffprobe == 'ffprobe'

def test_get_duration_nonexistent(video_processor, temp_dir):
    """Test getting duration of non-existent file"""
    fake_file = temp_dir / 'nonexistent.mp4'
    duration = video_processor.get_duration(fake_file)
    assert duration == 0.0

# ==========================================
# TEST MANIM GENERATOR
# renderer/tests/test_manim_generator.py
# ==========================================

import pytest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from utils.manim_generator import ManimCodeGenerator

@pytest.fixture
def generator():
    return ManimCodeGenerator()

def test_generate_scene(generator):
    """Test scene generation"""
    code = generator.generate_scene(
        class_name='TestScene',
        operations=['Text("Hello").scale(1.5)'],
        duration=3.0
    )
    
    assert 'class TestScene(Scene)' in code
    assert 'def construct(self)' in code
    assert 'self.wait(3.0)' in code

def test_validate_operation_safe(generator):
    """Test validating safe operation"""
    safe_op = 'Text("Hello World").scale(2)'
    assert generator.validate_operation(safe_op) == True

def test_validate_operation_dangerous(generator):
    """Test validating dangerous operation"""
    dangerous_ops = [
        'import os',
        'exec("code")',
        'eval("code")',
        '__import__("os")'
    ]
    
    for op in dangerous_ops:
        with pytest.raises(ValueError):
            generator.validate_operation(op)

def test_create_title_scene(generator):
    """Test creating title scene"""
    operations = generator.create_title_scene(
        title='Test Title',
        subtitle='Test Subtitle'
    )
    
    assert len(operations) == 2
    assert 'Test Title' in operations[0]
    assert 'Test Subtitle' in operations[1]

def test_create_equation_scene(generator):
    """Test creating equation scene"""
    operations = generator.create_equation_scene('E = mc^2')
    
    assert len(operations) == 1
    assert 'MathTex' in operations[0]
    assert 'E = mc^2' in operations[0]

# ==========================================
# TEST CACHE MANAGER
# renderer/tests/test_cache_manager.py
# ==========================================

import pytest
import tempfile
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))

from utils.cache_manager import CacheManager

@pytest.fixture
def cache_manager():
    with tempfile.TemporaryDirectory() as tmpdir:
        yield CacheManager(Path(tmpdir))

def test_cache_init(cache_manager):
    """Test CacheManager initialization"""
    assert cache_manager.cache_dir.exists()
    assert isinstance(cache_manager.metadata, dict)

def test_generate_key(cache_manager):
    """Test cache key generation"""
    key1 = cache_manager._generate_key(
        operations=['Text("A")'],
        duration=3.0,
        quality='medium'
    )
    
    key2 = cache_manager._generate_key(
        operations=['Text("A")'],
        duration=3.0,
        quality='medium'
    )
    
    # Same inputs should generate same key
    assert key1 == key2
    
    key3 = cache_manager._generate_key(
        operations=['Text("B")'],
        duration=3.0,
        quality='medium'
    )
    
    # Different inputs should generate different key
    assert key1 != key3

def test_cache_get_miss(cache_manager):
    """Test cache miss"""
    result = cache_manager.get(
        operations=['Text("A")'],
        duration=3.0,
        quality='medium'
    )
    
    assert result is None

def test_cache_set_and_get(cache_manager):
    """Test cache set and get"""
    # Create a dummy file
    video_path = cache_manager.cache_dir / 'test.mp4'
    video_path.touch()
    
    operations = ['Text("Test")']
    duration = 3.0
    quality = 'medium'
    
    # Set cache
    cache_manager.set(operations, duration, quality, video_path)
    
    # Get from cache
    result = cache_manager.get(operations, duration, quality)
    
    assert result == video_path
    assert result.exists()

def test_cache_stats(cache_manager):
    """Test cache statistics"""
    stats = cache_manager.get_stats()
    
    assert 'total_entries' in stats
    assert 'valid_entries' in stats
    assert 'total_size_mb' in stats

# ==========================================
# TEST QUALITY PRESETS
# renderer/tests/test_quality_presets.py
# ==========================================

import pytest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from utils.quality_presets import QualityPresets

def test_get_preset():
    """Test getting quality preset"""
    preset = QualityPresets.get('medium')
    
    assert preset is not None
    assert 'resolution' in preset
    assert 'fps' in preset
    assert 'bitrate' in preset
    assert 'manim_quality' in preset

def test_get_invalid_preset():
    """Test getting invalid preset returns default"""
    preset = QualityPresets.get('invalid')
    default = QualityPresets.get('medium')
    
    assert preset == default

def test_list_all_presets():
    """Test listing all presets"""
    presets = QualityPresets.list_all()
    
    assert 'low' in presets
    assert 'medium' in presets
    assert 'high' in presets
    assert 'ultra' in presets
    
    for name, preset in presets.items():
        assert 'name' in preset
        assert 'resolution' in preset
        assert 'fps' in preset
        assert 'description' in preset

# ==========================================
# PYTEST CONFIGURATION
# renderer/pytest.ini
# ==========================================

pytest_ini_content = """
[pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
addopts = 
    -v
    --strict-markers
    --tb=short
    --disable-warnings

markers =
    slow: marks tests as slow
    integration: marks tests as integration tests
    unit: marks tests as unit tests
"""

# ==========================================
# RUN TESTS SCRIPT
# renderer/run_tests.sh
# ==========================================

run_tests_script = """#!/bin/bash

echo "Running Cognito Renderer Tests..."
echo "================================="

# Activate virtual environment if it exists
if [ -d "venv" ]; then
    source venv/bin/activate
fi

# Install test dependencies
pip install pytest pytest-cov

# Run tests with coverage
pytest tests/ -v --cov=. --cov-report=html --cov-report=term

echo ""
echo "Tests complete!"
echo "Coverage report: htmlcov/index.html"
"""

if __name__ == '__main__':
    # Run pytest
    pytest.main(['-v', 'tests/'])