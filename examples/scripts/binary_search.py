from manim import *
import numpy as np


class GeneratedScene(Scene):
    def construct(self):
        self.camera.background_color = "#1a1a2e"

        # -- Title --
        title = Text("Binary Search", font_size=48, color=ORANGE)
        title.to_edge(UP, buff=0.5)
        subtitle = Text(
            "Halve the search range, every step",
            font_size=22, color=WHITE,
        ).next_to(title, DOWN, buff=0.25)
        self.play(Write(title), run_time=1.0)
        self.play(FadeIn(subtitle, shift=UP * 0.2), run_time=0.8)
        self.wait(0.6)

        # -- Sorted array --
        values = [1, 3, 5, 7, 11, 14, 18, 22]
        target = 11
        boxes = VGroup()
        for v in values:
            box = Square(side_length=0.85, color=BLUE, fill_opacity=0.25)
            label = Text(str(v), font_size=28, color=WHITE).move_to(box.get_center())
            boxes.add(VGroup(box, label))
        boxes.arrange(RIGHT, buff=0.18).move_to(ORIGIN + DOWN * 0.3)

        self.play(
            *[Create(c[0]) for c in boxes],
            *[Write(c[1]) for c in boxes],
            run_time=1.6,
        )
        self.wait(0.5)

        # -- Target indicator + comparison counter --
        target_text = MathTex(rf"\text{{Target}} = {target}", font_size=32, color=YELLOW)
        target_text.next_to(boxes, UP, buff=0.6)
        self.play(Write(target_text), run_time=0.9)

        comparisons = 0
        comp_text = Text(f"Comparisons: {comparisons}", font_size=22, color=WHITE)
        comp_text.to_edge(LEFT, buff=0.5).shift(DOWN * 2)
        self.play(Write(comp_text), run_time=0.6)
        self.wait(0.4)

        def update_comp_counter(n):
            nonlocal comp_text
            new_text = Text(f"Comparisons: {n}", font_size=22, color=WHITE)
            new_text.move_to(comp_text.get_center())
            self.play(Transform(comp_text, new_text), run_time=0.4)

        # -- Range markers --
        def make_arrow(label_str, color, idx, direction=DOWN):
            label = Text(label_str, font_size=22, color=color)
            arrow = Arrow(
                boxes[idx].get_center() + direction * 1.3,
                boxes[idx].get_center() + direction * 0.55,
                buff=0, color=color, stroke_width=4, max_tip_length_to_length_ratio=0.25,
            )
            label.next_to(arrow.get_start(), direction, buff=0.1)
            return VGroup(arrow, label)

        # -- Step 1: low=0, high=7, mid=3 (value 7) --
        low_idx, high_idx = 0, 7
        mid_idx = (low_idx + high_idx) // 2  # = 3
        low_marker = make_arrow("low", GREEN, low_idx, DOWN)
        high_marker = make_arrow("high", RED, high_idx, DOWN)
        self.play(FadeIn(low_marker), FadeIn(high_marker), run_time=0.9)

        # Highlight mid
        self.play(boxes[mid_idx][0].animate.set_color(YELLOW), run_time=0.7)
        comparisons += 1
        update_comp_counter(comparisons)
        check_text = Text(f"{values[mid_idx]} < {target} -> search right half", font_size=24, color=YELLOW)
        check_text.next_to(boxes, DOWN, buff=0.6)
        self.play(Write(check_text), run_time=1.0)
        self.wait(0.8)

        # Discard left half slowly so the elimination is visible
        for i in range(0, mid_idx + 1):
            self.play(
                boxes[i][0].animate.set_fill(GRAY, opacity=0.12).set_stroke(GRAY, opacity=0.25),
                run_time=0.18,
            )
        self.play(FadeOut(low_marker), FadeOut(check_text), run_time=0.5)

        # -- Step 2: low=4, high=7, mid=5 (value 14) --
        low_idx, high_idx = 4, 7
        mid_idx = (low_idx + high_idx) // 2  # = 5
        new_low = make_arrow("low", GREEN, low_idx, DOWN)
        self.play(FadeIn(new_low), run_time=0.6)
        self.play(boxes[mid_idx][0].animate.set_color(YELLOW), run_time=0.6)
        comparisons += 1
        update_comp_counter(comparisons)
        check2 = Text(f"{values[mid_idx]} > {target} -> search left half", font_size=24, color=YELLOW)
        check2.next_to(boxes, DOWN, buff=0.6)
        self.play(Write(check2), run_time=1.0)
        self.wait(0.8)

        # Discard right half (5..7)
        for i in [mid_idx, 6, 7]:
            self.play(
                boxes[i][0].animate.set_fill(GRAY, opacity=0.12).set_stroke(GRAY, opacity=0.25),
                run_time=0.2,
            )
        self.play(FadeOut(high_marker), FadeOut(check2), run_time=0.5)

        # -- Step 3: low=4, high=4, mid=4 (value 11) → FOUND --
        mid_idx = 4
        self.play(boxes[mid_idx][0].animate.set_color(YELLOW), run_time=0.6)
        comparisons += 1
        update_comp_counter(comparisons)
        self.wait(0.4)
        self.play(
            boxes[mid_idx][0].animate.set_color(GREEN).set_fill(GREEN, opacity=0.5),
            run_time=0.8,
        )
        found = Text(f"Found {target}!", font_size=36, color=GREEN, weight=BOLD)
        found.next_to(boxes, DOWN, buff=0.6)
        self.play(Write(found), run_time=1.0)
        self.wait(1.0)

        # -- Closing: contrast with linear search --
        self.play(FadeOut(found), FadeOut(new_low), run_time=0.6)
        contrast = VGroup(
            Text("Binary search: 3 comparisons", font_size=22, color=GREEN),
            Text("Linear search: up to 8 comparisons", font_size=22, color=GRAY),
            MathTex(r"O(\log n)\ \text{ vs }\ O(n)", font_size=28, color=ORANGE),
        ).arrange(DOWN, buff=0.25)
        contrast.next_to(boxes, DOWN, buff=0.6)

        self.play(Write(contrast[0]), run_time=0.9)
        self.play(Write(contrast[1]), run_time=0.9)
        self.play(Write(contrast[2]), run_time=1.2)
        self.wait(2.5)
