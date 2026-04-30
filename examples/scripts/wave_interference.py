from manim import *
import numpy as np


class GeneratedScene(Scene):
    def construct(self):
        self.camera.background_color = "#1a1a2e"

        # -- Title --
        title = Text("Wave Interference", font_size=44, color=BLUE)
        title.to_edge(UP, buff=0.5)
        subtitle = Text(
            "Two waves combine -- they add or cancel",
            font_size=22, color=WHITE,
        ).next_to(title, DOWN, buff=0.2)
        self.play(Write(title), run_time=1.0)
        self.play(FadeIn(subtitle, shift=UP * 0.2), run_time=0.8)
        self.wait(0.6)

        # -- Axes --
        axes = Axes(
            x_range=[0, 4 * PI, PI],
            y_range=[-2.5, 2.5, 1],
            x_length=10,
            y_length=4,
            axis_config={"include_numbers": False, "stroke_width": 2, "color": GRAY},
        )
        axes.shift(DOWN * 0.4)
        self.play(Create(axes), run_time=1.2)

        # -- Show wave 1 alone --
        wave1_label = MathTex(r"y_1 = \sin(x)", font_size=28, color=BLUE)
        wave1_label.next_to(axes, UP, buff=0.4).shift(LEFT * 3.5)
        wave1 = axes.plot(lambda x: np.sin(x), color=BLUE, stroke_width=3, x_range=[0, 4 * PI])
        self.play(Create(wave1), Write(wave1_label), run_time=1.6)
        self.wait(1.0)

        # -- Show wave 2 alone (with phase shift) --
        phase = ValueTracker(0)

        wave2 = always_redraw(lambda: axes.plot(
            lambda x: np.sin(x + phase.get_value()),
            color=GREEN, stroke_width=3, x_range=[0, 4 * PI],
        ))
        wave2_label = MathTex(r"y_2 = \sin(x + \varphi)", font_size=28, color=GREEN)
        wave2_label.next_to(axes, UP, buff=0.4).shift(RIGHT * 3.5)

        self.play(Create(wave2), Write(wave2_label), run_time=1.4)
        self.wait(0.8)

        # -- Show the sum --
        wave_sum = always_redraw(lambda: axes.plot(
            lambda x: np.sin(x) + np.sin(x + phase.get_value()),
            color=YELLOW, stroke_width=4, x_range=[0, 4 * PI],
        ))
        sum_label = MathTex(r"y_1 + y_2", font_size=32, color=YELLOW)
        sum_label.next_to(axes, DOWN, buff=0.4)
        self.play(Create(wave_sum), Write(sum_label), run_time=1.6)
        self.wait(0.6)

        # -- Status text that updates with the phase --
        def make_status():
            phi = phase.get_value()
            phi_norm = phi % (2 * PI)
            if phi_norm < 0.4 or phi_norm > 2 * PI - 0.4:
                txt = "Constructive: amplitudes add (2x)"
                col = GREEN
            elif abs(phi_norm - PI) < 0.4:
                txt = "Destructive: waves cancel (0)"
                col = RED
            else:
                txt = "Partial overlap"
                col = WHITE
            label = Text(txt, font_size=22, color=col)
            label.to_edge(DOWN, buff=0.4)
            return label

        status = always_redraw(make_status)
        self.play(FadeIn(status), run_time=0.7)
        self.wait(0.4)

        # -- Sweep through several phase positions --
        # 0 -> π (constructive -> destructive)
        self.play(
            phase.animate.set_value(PI),
            run_time=3.5, rate_func=rate_functions.smooth,
        )
        self.wait(0.7)

        # π -> π/2 (destructive -> partial)
        self.play(
            phase.animate.set_value(PI / 2),
            run_time=2.0, rate_func=rate_functions.smooth,
        )
        self.wait(0.5)

        # π/2 -> 0 (partial -> constructive)
        self.play(
            phase.animate.set_value(0),
            run_time=2.0, rate_func=rate_functions.smooth,
        )
        self.wait(0.6)

        # -- Closing: jump to 2π for a smooth full revolution loop --
        self.play(
            phase.animate.set_value(2 * PI),
            run_time=4.0, rate_func=rate_functions.linear,
        )

        self.wait(1.5)
