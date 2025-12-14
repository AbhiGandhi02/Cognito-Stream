# ==========================================
# CACHE MANAGER
# renderer/utils/cache_manager.py
# ==========================================

import json
import hashlib
from pathlib import Path
from typing import Optional
import logging

logger = logging.getLogger(__name__)

class CacheManager:
    """Manage rendered video cache"""
    
    def __init__(self, cache_dir: Path):
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(exist_ok=True, parents=True)
        self.metadata_file = cache_dir / 'cache_metadata.json'
        self.metadata = self._load_metadata()
    
    def _load_metadata(self) -> dict:
        """Load cache metadata"""
        if self.metadata_file.exists():
            try:
                with open(self.metadata_file, 'r') as f:
                    return json.load(f)
            except Exception as e:
                logger.error(f"Failed to load metadata: {e}")
        return {}
    
    def _save_metadata(self):
        """Save cache metadata"""
        try:
            with open(self.metadata_file, 'w') as f:
                json.dump(self.metadata, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save metadata: {e}")
    
    def _generate_key(self, operations: list, duration: float, quality: str) -> str:
        """Generate cache key from parameters"""
        data = {
            'operations': operations,
            'duration': duration,
            'quality': quality
        }
        content = json.dumps(data, sort_keys=True)
        return hashlib.sha256(content.encode()).hexdigest()
    
    def get(
        self,
        operations: list,
        duration: float,
        quality: str
    ) -> Optional[Path]:
        """Get cached video if exists"""
        key = self._generate_key(operations, duration, quality)
        
        if key in self.metadata:
            video_path = Path(self.metadata[key]['path'])
            if video_path.exists():
                logger.info(f"Cache hit: {key}")
                return video_path
            else:
                # Remove stale entry
                del self.metadata[key]
                self._save_metadata()
        
        return None
    
    def set(
        self,
        operations: list,
        duration: float,
        quality: str,
        video_path: Path
    ):
        """Add video to cache"""
        key = self._generate_key(operations, duration, quality)
        
        self.metadata[key] = {
            'path': str(video_path),
            'operations': operations,
            'duration': duration,
            'quality': quality,
            'created_at': str(Path(video_path).stat().st_ctime)
        }
        
        self._save_metadata()
        logger.info(f"Cached: {key}")
    
    def clear_old(self, days: int = 7):
        """Clear cache entries older than specified days"""
        import time
        cutoff = time.time() - (days * 86400)
        
        removed = []
        for key, data in list(self.metadata.items()):
            path = Path(data['path'])
            if path.exists():
                if path.stat().st_mtime < cutoff:
                    path.unlink()
                    removed.append(key)
            else:
                removed.append(key)
        
        for key in removed:
            del self.metadata[key]
        
        self._save_metadata()
        logger.info(f"Cleared {len(removed)} cache entries")
    
    def get_stats(self) -> dict:
        """Get cache statistics"""
        total_size = 0
        valid_entries = 0
        
        for key, data in self.metadata.items():
            path = Path(data['path'])
            if path.exists():
                total_size += path.stat().st_size
                valid_entries += 1
        
        return {
            'total_entries': len(self.metadata),
            'valid_entries': valid_entries,
            'total_size_mb': round(total_size / 1024 / 1024, 2)
        }