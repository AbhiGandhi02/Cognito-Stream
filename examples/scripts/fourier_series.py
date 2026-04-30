from manim import *
import numpy as np


class GeneratedScene(Scene):
    def construct(self):
        self.camera.background_color = "#1a1a2e"

        # -- Title --
        title = Text("Fourier Series", font_size=44, color=PINK)
        title.to_edge(UP, buff=0.5)
        subtitle = Text(
            "A square wave from sums of sines",
            font_size=22, color=WHITE,
        ).next_to(title, DOWN, buff=0.2)
        self.play(Write(title), run_time=1.0)
        self.play(FadeIn(subtitle, shift=UP * 0.2), run_time=0.8)
        self.wait(0.6)

        # -- Axes --
        axes = Axes(
            x_range=[-PI, PI, PI / 2],
            y_range=[-1.5, 1.5, 0.5],
            x_length=10,
            y_length=3.6,
            axis_config={"include_numbers": False, "stroke_width": 2, "color": GRAY},
        )
        axes.shift(DOWN * 0.6)
        self.play(Create(axes), run_time=1.2)

        # The target square wave (drawn faintly behind the partial sums for reference)
        target_wave = axes.plot(
            lambda x: 1 if (x % (2 * PI)) < PI else -1,
            color=GRAY, stroke_width=2, stroke_opacity=0.4,
            x_range=[-PI, PI, 0.005],  # high resolution to render the discontinuities
            use_smoothing=False,
        )
        target_label = Text("target: square wave", font_size=18, color=GRAY)
        target_label.next_to(axes, RIGHT, buff=0.1).shift(UP * 1.3)
        self.play(Create(target_wave), Write(target_label), run_time=1.5)
        self.wait(0.5)

        # Square-wave Fourier series: f(x) = (4/π) Σ sin((2k-1)x) / (2k-1)
        def partial_sum(n_terms):
            def f(x):
                return (4 / PI) * sum(
                    np.sin((2 * k - 1) * x) / (2 * k - 1) for k in range(1, n_terms + 1)
                )
            return f

        # -- Term 1 (n=1): just sin(x) --
        wave = axes.plot(partial_sum(1), color=BLUE, x_range=[-PI, PI], stroke_width=4)
        eq1 = MathTex(r"\frac{4}{\pi}\sin(x)", font_size=30, color=BLUE)
        eq1.to_edge(DOWN, buff=0.4).shift(LEFT * 4)
        self.play(Create(wave), Write(eq1), run_time=1.6)
        self.wait(1.2)

        # -- Term 3 --
        wave_new = axes.plot(partial_sum(2), color=GREEN, x_range=[-PI, PI], stroke_width=4)
        eq3 = MathTex(r"+ \frac{1}{3}\sin(3x)", font_size=30, color=GREEN).next_to(eq1, RIGHT, buff=0.2)
        self.play(Transform(wave, wave_new), Write(eq3), run_time=1.6)
        self.wait(1.0)

        # -- Term 5 --
        wave_new = axes.plot(partial_sum(3), color=YELLOW, x_range=[-PI, PI], stroke_width=4)
        eq5 = MathTex(r"+ \frac{1}{5}\sin(5x)", font_size=30, color=YELLOW).next_to(eq3, RIGHT, buff=0.2)
        self.play(Transform(wave, wave_new), Write(eq5), run_time=1.5)
        self.wait(1.0)

        # -- Term 7 --
        wave_new = axes.plot(partial_sum(4), color=ORANGE, x_range=[-PI, PI], stroke_width=4)
        eq7 = MathTex(r"+ \frac{1}{7}\sin(7x)", font_size=30, color=ORANGE).next_to(eq5, RIGHT, buff=0.2)
        self.play(Transform(wave, wave_new), Write(eq7), run_time=1.5)
        self.wait(1.0)

        # -- Many more terms --
        wave_new = axes.plot(
            partial_sum(20), color=RED, x_range=[-PI, PI, 0.005], stroke_width=3,
            use_smoothing=False,
        )
        eq_many = MathTex(r"+ \cdots", font_size=30, color=RED).next_to(eq7, RIGHT, buff=0.2)
        self.play(Transform(wave, wave_new), Write(eq_many), run_time=1.8)
        self.wait(1.0)

        # -- Caption: it converges to the square wave --
        result = Text(
            "Sum of all odd harmonics -> square wave",
            font_size=22, color=WHITE,
        )
        result.next_to(axes, UP, buff=0.4)
        self.play(Write(result), run_time=1.4)
        self.wait(1.5)

        # -- Pulse to highlight the Gibbs phenomenon overshoot --
        gibbs_caption = Text(
            "Notice the overshoot near the jumps (Gibbs phenomenon)",
            font_size=18, color=YELLOW,
        )
        gibbs_caption.to_edge(DOWN, buff=0.05)
        self.play(Write(gibbs_caption), run_time=1.4)

        self.wait(2.5)
