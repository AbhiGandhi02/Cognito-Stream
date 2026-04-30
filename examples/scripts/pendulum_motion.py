from manim import *
import numpy as np


class GeneratedScene(Scene):
    def construct(self):
        self.camera.background_color = "#1a1a2e"

        # -- Title --
        title = Text("Simple Pendulum", font_size=44, color=PURPLE)
        title.to_edge(UP, buff=0.5)
        subtitle = Text(
            "Period depends on length, not mass",
            font_size=22, color=WHITE,
        ).next_to(title, DOWN, buff=0.25)
        self.play(Write(title), run_time=1.2)
        self.play(FadeIn(subtitle, shift=UP * 0.2), run_time=0.8)
        self.wait(0.6)

        # -- Pendulum geometry --
        pivot = np.array([0, 2.0, 0])
        rod_length = 3.2
        max_angle = 38 * DEGREES

        pivot_dot = Dot(pivot, radius=0.08, color=WHITE)
        angle = ValueTracker(max_angle)

        def make_rod():
            theta = angle.get_value()
            bob_pos = pivot + rod_length * np.array([np.sin(theta), -np.cos(theta), 0])
            return Line(pivot, bob_pos, color=GRAY, stroke_width=4)

        def make_bob():
            theta = angle.get_value()
            bob_pos = pivot + rod_length * np.array([np.sin(theta), -np.cos(theta), 0])
            return Dot(bob_pos, radius=0.25, color=PURPLE).set_fill(PURPLE, opacity=0.9)

        rod = always_redraw(make_rod)
        bob = always_redraw(make_bob)

        # Vertical reference line (rest position)
        rest_line = DashedLine(
            pivot, pivot + rod_length * DOWN,
            color=GRAY, stroke_opacity=0.4, dash_length=0.12,
        )

        # Length annotation
        L_label = MathTex("L", color=WHITE, font_size=32)
        L_label.move_to(pivot + DOWN * (rod_length / 2) + RIGHT * 0.4)

        self.play(Create(pivot_dot), Create(rest_line), run_time=0.8)
        self.play(Create(rod), Create(bob), Write(L_label), run_time=1.0)
        self.wait(0.6)

        # -- Trace the bob's path with a faint arc as it swings --
        # Arc showing the swing path
        arc_path = Arc(
            radius=rod_length,
            start_angle=-PI / 2 - max_angle,
            angle=2 * max_angle,
            color=YELLOW,
            stroke_opacity=0.3,
            stroke_width=2,
        ).move_arc_center_to(pivot)
        self.play(Create(arc_path), run_time=0.8)
        self.wait(0.4)

        # -- Oscillate: 4 full periods --
        for _ in range(4):
            self.play(
                angle.animate.set_value(-max_angle),
                run_time=1.4, rate_func=rate_functions.smooth,
            )
            self.play(
                angle.animate.set_value(max_angle),
                run_time=1.4, rate_func=rate_functions.smooth,
            )

        # Settle smoothly to rest
        self.play(
            angle.animate.set_value(0),
            run_time=1.2, rate_func=rate_functions.smooth,
        )
        self.wait(0.5)

        # -- Period formula reveal --
        self.play(FadeOut(subtitle), FadeOut(arc_path), run_time=0.5)

        # Move pendulum left to make room for the formula
        pendulum_assets = VGroup(pivot_dot, rest_line, L_label)
        self.play(pendulum_assets.animate.shift(LEFT * 2.5), run_time=0.8)
        # Rebuild rod and bob with the shifted pivot via new closures
        self.remove(rod, bob)
        new_pivot = pivot + LEFT * 2.5
        rod = always_redraw(lambda: Line(
            new_pivot,
            new_pivot + rod_length * np.array([np.sin(angle.get_value()), -np.cos(angle.get_value()), 0]),
            color=GRAY, stroke_width=4,
        ))
        bob = always_redraw(lambda: Dot(
            new_pivot + rod_length * np.array([np.sin(angle.get_value()), -np.cos(angle.get_value()), 0]),
            radius=0.25, color=PURPLE,
        ).set_fill(PURPLE, opacity=0.9))
        self.add(rod, bob)

        # Period formula on the right
        formula = MathTex(r"T = 2\pi \sqrt{\frac{L}{g}}", font_size=56, color=WHITE)
        formula.shift(RIGHT * 2.5)

        self.play(Write(formula), run_time=1.6)
        self.wait(0.6)

        # Highlight L in formula and the pendulum at the same time
        l_in_formula = formula[0][6]  # the 'L' character (approximately)
        # Safer: just pulse the whole formula
        self.play(formula.animate.scale(1.08), run_time=0.5)
        self.play(formula.animate.scale(1 / 1.08), run_time=0.5)

        # Closing oscillation while formula is shown
        self.play(
            angle.animate.set_value(max_angle),
            run_time=1.2, rate_func=rate_functions.smooth,
        )
        self.play(
            angle.animate.set_value(-max_angle),
            run_time=1.6, rate_func=rate_functions.smooth,
        )
        self.play(
            angle.animate.set_value(0),
            run_time=1.2, rate_func=rate_functions.smooth,
        )

        self.wait(2.0)
