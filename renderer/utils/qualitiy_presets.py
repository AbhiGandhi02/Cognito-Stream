# ==========================================
# QUALITY PRESETS
# renderer/utils/quality_presets.py
# ==========================================

class QualityPresets:
    """Video quality preset configurations"""
    
    PRESETS = {
        'low': {
            'name': 'Low Quality',
            'resolution': (854, 480),
            'fps': 24,
            'bitrate': '1000k',
            'manim_quality': 'l',
            'description': 'Fast rendering, smaller file size'
        },
        'medium': {
            'name': 'Medium Quality',
            'resolution': (1280, 720),
            'fps': 30,
            'bitrate': '2500k',
            'manim_quality': 'm',
            'description': 'Balanced quality and speed'
        },
        'high': {
            'name': 'High Quality',
            'resolution': (1920, 1080),
            'fps': 30,
            'bitrate': '5000k',
            'manim_quality': 'h',
            'description': 'High quality, slower rendering'
        },
        'ultra': {
            'name': 'Ultra Quality',
            'resolution': (2560, 1440),
            'fps': 60,
            'bitrate': '8000k',
            'manim_quality': 'p',
            'description': 'Maximum quality, slowest rendering'
        }
    }
    
    @classmethod
    def get(cls, quality: str) -> dict:
        """Get quality preset"""
        return cls.PRESETS.get(quality, cls.PRESETS['medium'])
    
    @classmethod
    def list_all(cls) -> dict:
        """List all available presets"""
        return {
            name: {
                'name': preset['name'],
                'resolution': preset['resolution'],
                'fps': preset['fps'],
                'description': preset['description']
            }
            for name, preset in cls.PRESETS.items()
        }