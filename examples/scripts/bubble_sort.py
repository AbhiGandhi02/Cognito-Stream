from manim import *
import numpy as np


class GeneratedScene(Scene):
    def construct(self):
        self.camera.background_color = "#1a1a2e"

        # -- Title --
        title = Text("Bubble Sort", font_size=48, color=BLUE)
        title.to_edge(UP, buff=0.5)
        subtitle = Text(
            "Compare adjacent pairs, swap when out of order",
            font_size=20, color=WHITE,
        ).next_to(title, DOWN, buff=0.25)
        self.play(Write(title), run_time=1.0)
        self.play(FadeIn(subtitle, shift=UP * 0.2), run_time=0.7)
        self.wait(0.6)

        # -- Build the array as VGroup of (Square + label) cells --
        values = [5, 2, 8, 1, 3]
        boxes = VGroup()
        for v in values:
            box = Square(side_length=1.0, color=BLUE, fill_opacity=0.3)
            label = Text(str(v), font_size=36, color=WHITE).move_to(box.get_center())
            boxes.add(VGroup(box, label))
        boxes.arrange(RIGHT, buff=0.3).move_to(ORIGIN + DOWN * 0.3)

        self.play(
            *[Create(c[0]) for c in boxes],
            *[Write(c[1]) for c in boxes],
            run_time=1.5,
        )
        self.wait(0.4)

        # Pass label that updates each pass.
        pass_label = Text("Pass 1", font_size=26, color=YELLOW).next_to(boxes, UP, buff=0.7)
        self.play(Write(pass_label), run_time=0.6)

        def compare_and_swap(i, j, do_swap):
            cell_i, cell_j = boxes[i], boxes[j]
            self.play(
                cell_i[0].animate.set_color(YELLOW),
                cell_j[0].animate.set_color(YELLOW),
                run_time=0.45,
            )
            self.wait(0.3)
            if do_swap:
                pos_i = cell_i.get_center()
                pos_j = cell_j.get_center()
                self.play(
                    cell_i.animate.move_to(pos_j),
                    cell_j.animate.move_to(pos_i),
                    run_time=0.85,
                )
                # Re-index in the VGroup so future indexing matches visual order.
                boxes[i], boxes[j] = boxes[j], boxes[i]
            self.play(
                boxes[i][0].animate.set_color(BLUE),
                boxes[j][0].animate.set_color(BLUE),
                run_time=0.35,
            )

        # Track the working list to drive swap decisions.
        working = list(values)

        def do_pass(pass_num, n):
            """Run one pass of bubble sort over the first n positions."""
            for i in range(n - 1):
                if working[i] > working[i + 1]:
                    compare_and_swap(i, i + 1, do_swap=True)
                    working[i], working[i + 1] = working[i + 1], working[i]
                else:
                    compare_and_swap(i, i + 1, do_swap=False)

        # -- Pass 1 --
        do_pass(1, 5)
        # Lock the largest into place (rightmost)
        self.play(boxes[4][0].animate.set_color(GREEN), run_time=0.4)
        self.wait(0.3)

        # -- Pass 2 --
        new_label = Text("Pass 2", font_size=26, color=YELLOW).next_to(boxes, UP, buff=0.7)
        self.play(Transform(pass_label, new_label), run_time=0.6)
        do_pass(2, 4)
        self.play(boxes[3][0].animate.set_color(GREEN), run_time=0.4)
        self.wait(0.3)

        # -- Pass 3 (last meaningful pass for this array) --
        new_label2 = Text("Pass 3", font_size=26, color=YELLOW).next_to(boxes, UP, buff=0.7)
        self.play(Transform(pass_label, new_label2), run_time=0.6)
        do_pass(3, 3)
        self.play(
            boxes[2][0].animate.set_color(GREEN),
            boxes[1][0].animate.set_color(GREEN),
            boxes[0][0].animate.set_color(GREEN),
            run_time=0.6,
        )

        # -- Done --
        done = Text("Sorted!", font_size=40, color=GREEN, weight=BOLD).next_to(boxes, DOWN, buff=0.6)
        self.play(FadeOut(pass_label), Write(done), run_time=1.0)
        self.wait(2.5)
