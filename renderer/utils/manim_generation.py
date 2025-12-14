# ==========================================
# MANIM GENERATOR
# renderer/utils/manim_generator.py
# ==========================================

from typing import List, Dict, Any
import logging

logger = logging.getLogger(__name__)

class ManimCodeGenerator:
    """Generate Manim scene code from structured data"""
    
    TEMPLATE_INTRO = '''from manim import *
import numpy as np

config.frame_rate = {fps}
config.pixel_height = {height}
config.pixel_width = {width}
config.background_color = "{bg_color}"

class {class_name}(Scene):
    def construct(self):
'''
    
    OPERATION_TEMPLATE = '''        # {comment}
        try:
            {code}
        except Exception as e:
            logger.error(f"Operation error: {{e}}")
'''
    
    def __init__(self):
        self.default_config = {
            'fps': 30,
            'width': 1280,
            'height': 720,
            'bg_color': '#1a1a1a'
        }
    
    def generate_scene(
        self,
        class_name: str,
        operations: List[str],
        duration: float,
        config: Dict[str, Any] = None
    ) -> str:
        """Generate complete scene code"""
        
        cfg = {**self.default_config, **(config or {})}
        
        # Start with template
        code = self.TEMPLATE_INTRO.format(
            class_name=class_name,
            **cfg
        )
        
        # Add operations
        for i, op in enumerate(operations):
            code += self.OPERATION_TEMPLATE.format(
                comment=f"Operation {i+1}",
                code=self._format_operation(op, i)
            )
        
        # Add wait for duration
        code += f"\n        self.wait({duration})\n"
        
        return code
    
    def _format_operation(self, operation: str, index: int) -> str:
        """Format a single operation"""
        var_name = f"obj_{index}"
        
        # Add object to scene
        formatted = f"{var_name} = {operation}\n"
        formatted += f"            self.add({var_name})"
        
        return formatted
    
    def validate_operation(self, operation: str) -> bool:
        """Validate a Manim operation"""
        dangerous = [
            'import', 'exec', 'eval', 'open', '__import__',
            'compile', 'system', 'subprocess', 'os.'
        ]
        
        op_lower = operation.lower()
        for pattern in dangerous:
            if pattern in op_lower:
                raise ValueError(f"Dangerous pattern: {pattern}")
        
        return True
    
    def create_title_scene(self, title: str, subtitle: str = None) -> List[str]:
        """Generate operations for a title scene"""
        operations = [
            f'Text("{title}", font_size=48, color=WHITE).shift(UP)'
        ]
        
        if subtitle:
            operations.append(
                f'Text("{subtitle}", font_size=24, color=GRAY).shift(DOWN*0.5)'
            )
        
        return operations
    
    def create_equation_scene(self, equation: str) -> List[str]:
        """Generate operations for an equation scene"""
        return [
            f'MathTex("{equation}", font_size=60, color=BLUE)'
        ]
    
    def create_diagram_scene(self, elements: List[str]) -> List[str]:
        """Generate operations for a diagram"""
        operations = []
        spacing = 2
        start_pos = -(len(elements) - 1) * spacing / 2
        
        for i, element in enumerate(elements):
            pos = start_pos + i * spacing
            operations.append(
                f'Text("{element}", font_size=32).shift(RIGHT*{pos})'
            )
        
        return operations



