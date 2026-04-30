from manim import *
import numpy as np


class GeneratedScene(Scene):
    def construct(self):
        self.camera.background_color = "#1a1a2e"

        # -- Title --
        title = Text("The Pythagorean Theorem", font_size=42, color=BLUE)
        title.to_edge(UP, buff=0.5)
        subtitle = Text(
            "Squares on the legs equal the square on the hypotenuse",
            font_size=20, color=WHITE,
        ).next_to(title, DOWN, buff=0.2)
        self.play(Write(title), run_time=1.2)
        self.play(FadeIn(subtitle, shift=UP * 0.2), run_time=0.8)
        self.wait(0.6)
        self.play(FadeOut(subtitle), run_time=0.5)

        # -- Right triangle, kept compact and shifted LEFT so the formula has
        #    room on the right without overlap. Shifted DOWN as well so the
        #    rotated square on the hypotenuse doesn't crowd the title.
        a_len = 2.0
        b_len = 1.5
        A = np.array([-1.5, -0.9, 0])     # right-angle corner (lower-left)
        B = A + np.array([a_len, 0, 0])   # lower-right
        C = A + np.array([0, b_len, 0])   # upper-left

        side_a = Line(A, B, color=RED, stroke_width=6)
        side_b = Line(A, C, color=GREEN, stroke_width=6)
        side_c = Line(B, C, color=YELLOW, stroke_width=6)
        right_angle = Square(side_length=0.25, color=WHITE, stroke_width=2)
        right_angle.move_to(A + np.array([0.125, 0.125, 0]))

        label_a = MathTex("a", color=RED, font_size=34).next_to(side_a, DOWN, buff=0.15)
        label_b = MathTex("b", color=GREEN, font_size=34).next_to(side_b, LEFT, buff=0.15)
        # Skipping the on-side "c" label: the yellow hypotenuse + "c^2" inside
        # the rotated square already communicate it, and any UR/DR placement
        # collides with sq_c's footprint.

        self.play(
            Create(side_a), Create(side_b), Create(side_c), Create(right_angle),
            run_time=1.8,
        )
        self.play(Write(label_a), Write(label_b), run_time=1.0)
        self.wait(0.8)

        # -- Visual proof: square on side a (below the triangle) --
        sq_a = Square(side_length=a_len, color=RED, fill_opacity=0.25, stroke_width=3)
        sq_a.move_to([(A[0] + B[0]) / 2, A[1] - a_len / 2, 0])
        sq_a_label = MathTex("a^2", color=RED, font_size=32).move_to(sq_a.get_center())
        self.play(Create(sq_a), Write(sq_a_label), run_time=1.8)
        self.wait(0.6)

        # -- Square on side b (to the left of the triangle) --
        sq_b = Square(side_length=b_len, color=GREEN, fill_opacity=0.25, stroke_width=3)
        sq_b.move_to([A[0] - b_len / 2, (A[1] + C[1]) / 2, 0])
        sq_b_label = MathTex("b^2", color=GREEN, font_size=28).move_to(sq_b.get_center())
        self.play(Create(sq_b), Write(sq_b_label), run_time=1.8)
        self.wait(0.6)

        # -- Square on hypotenuse c (rotated to align with side_c) --
        # Length and direction of hypotenuse
        c_vec = C - B
        c_len = float(np.linalg.norm(c_vec))
        c_dir = c_vec / c_len
        # Outward perpendicular = the side away from A (the right-angle vertex).
        # Try one of the two perpendiculars; flip if it points TOWARD A.
        perp = np.array([-c_dir[1], c_dir[0], 0])  # 90 degrees counter-clockwise
        midpoint_c = (B + C) / 2
        # Vector from midpoint to A
        to_A = A - midpoint_c
        if float(np.dot(perp, to_A)) > 0:
            # perp points TOWARD A, flip it
            perp = -perp
        sq_c = Square(side_length=c_len, color=YELLOW, fill_opacity=0.25, stroke_width=3)
        sq_c.move_to(midpoint_c + perp * (c_len / 2))
        sq_c.rotate(float(np.arctan2(c_dir[1], c_dir[0])))
        sq_c_label = MathTex("c^2", color=YELLOW, font_size=28).move_to(sq_c.get_center())
        self.play(Create(sq_c), Write(sq_c_label), run_time=2.0)
        self.wait(0.8)

        # -- Formula on the RIGHT side, well clear of the triangle group.
        #    Triangle group + squares occupy x ∈ [-3, ~2.0]; formula goes to
        #    x≈4 (right half of the frame). Vertically centered.
        formula = MathTex("a^2", "+", "b^2", "=", "c^2", font_size=56)
        formula[0].set_color(RED)
        formula[2].set_color(GREEN)
        formula[4].set_color(YELLOW)
        formula.move_to(np.array([4.0, 0.0, 0]))

        self.play(Write(formula), run_time=1.6)
        self.wait(0.8)

        # -- Pulse: link each formula term to its square + side --
        for idx, side, square in [
            (0, side_a, sq_a),
            (2, side_b, sq_b),
            (4, side_c, sq_c),
        ]:
            self.play(
                formula[idx].animate.scale(1.18),
                side.animate.set_stroke(width=10),
                square.animate.set_fill(opacity=0.5),
                run_time=0.55,
            )
            self.play(
                formula[idx].animate.scale(1 / 1.18),
                side.animate.set_stroke(width=6),
                square.animate.set_fill(opacity=0.25),
                run_time=0.5,
            )

        self.wait(2.5)
