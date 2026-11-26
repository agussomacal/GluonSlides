"""Draws the GluonSlides icon: a floating balloon made of many small balloons
in nine colours (the 3 x 3 colour-anticolour pairs carried by gluons),
carrying a basket by its strings, with someone waving in it.

    python packaging/make_icon.py      # writes packaging/icon.png (1024 px) and icon.svg

The layout is random but fixed (seed), so it always draws the same icon.
The icon is dedicated to the public domain (CC0 1.0): see packaging/ICON-LICENSE.
Needs pycairo (python3-gi-cairo / pip install pycairo).
"""
import math
import random
from pathlib import Path

import cairo

HERE = Path(__file__).resolve().parent

NINE = [
    (0.91, 0.22, 0.26),  # red
    (0.12, 0.70, 0.38),  # green
    (0.18, 0.42, 0.95),  # blue
    (0.10, 0.75, 0.85),  # cyan
    (0.84, 0.25, 0.74),  # magenta
    (0.98, 0.78, 0.15),  # yellow
    (0.98, 0.50, 0.12),  # orange
    (0.52, 0.32, 0.90),  # violet
    (0.07, 0.55, 0.52),  # teal
]


def pack_sphere(n, ball_r, rng, tries=400000):
    """Up to n non-overlapping balls of radius ball_r inside the unit sphere
    (random sequential packing, with a grid for the overlap test)."""
    pts, grid = [], {}
    limit, min_d2, cell = 1 - ball_r, (2 * ball_r * 0.97) ** 2, 2 * ball_r
    for _ in range(tries):
        if len(pts) >= n:
            break
        x, y, z = (rng.uniform(-limit, limit) for _ in range(3))
        if x * x + y * y + z * z > limit * limit:
            continue
        i, j, k = int(x // cell), int(y // cell), int(z // cell)
        if any((x - a) ** 2 + (y - b) ** 2 + (z - c) ** 2 < min_d2
               for di in (-1, 0, 1) for dj in (-1, 0, 1) for dk in (-1, 0, 1)
               for a, b, c in grid.get((i + di, j + dj, k + dk), ())):
            continue
        pts.append((x, y, z))
        grid.setdefault((i, j, k), []).append((x, y, z))
    return pts


INK = (0.07, 0.08, 0.11)
STRING = (0.30, 0.30, 0.34)
BASKET = (0.55, 0.36, 0.20)


def balloon(cr, x, y, r, colour, depth, stretch=1.12):
    """A small balloon: slightly taller than wide, lit from the upper left."""
    dim = 1 - 0.30 * depth
    base = tuple(c * dim for c in colour)
    light = tuple(min(1, c * dim + 0.5 * (1 - c)) for c in colour)
    dark = tuple(c * dim * 0.55 for c in colour)
    cr.save()
    cr.translate(x, y)
    cr.scale(1, stretch)
    g = cairo.RadialGradient(-r * 0.35, -r * 0.4, r * 0.05, 0, 0, r)
    g.add_color_stop_rgb(0.0, *light)
    g.add_color_stop_rgb(0.55, *base)
    g.add_color_stop_rgb(1.0, *dark)
    cr.arc(0, 0, r, 0, 2 * math.pi)
    cr.set_source(g)
    cr.fill()
    cr.restore()


def person_in_basket(cr, cx, top, w):
    """Basket (a trapezoid) with a black silhouette: head and shoulders over
    the rim, one arm waving."""
    h = w * 0.6
    cr.set_source_rgb(*INK)
    head_r = w * 0.13
    hx, hy = cx - w * 0.04, top - w * 0.30
    cr.arc(hx, hy, head_r, 0, 2 * math.pi)
    cr.fill()
    # shoulders
    cr.move_to(hx - w * 0.24, top + 1)
    cr.curve_to(hx - w * 0.24, top - w * 0.16, hx + w * 0.24, top - w * 0.16, hx + w * 0.24, top + 1)
    cr.close_path()
    cr.fill()
    # waving arm: from the shoulder, up and out
    cr.set_line_width(w * 0.075)
    cr.set_line_cap(cairo.LINE_CAP_ROUND)
    cr.set_line_join(cairo.LINE_JOIN_ROUND)
    cr.move_to(hx + w * 0.18, top - w * 0.08)
    cr.line_to(hx + w * 0.36, top - w * 0.26)
    cr.line_to(hx + w * 0.40, top - w * 0.46)
    cr.stroke()
    # basket
    cr.move_to(cx - w / 2, top)
    cr.line_to(cx + w / 2, top)
    cr.line_to(cx + w * 0.38, top + h)
    cr.line_to(cx - w * 0.38, top + h)
    cr.close_path()
    g = cairo.LinearGradient(0, top, 0, top + h)
    g.add_color_stop_rgb(0, *BASKET)
    g.add_color_stop_rgb(1, *(c * 0.65 for c in BASKET))
    cr.set_source(g)
    cr.fill()
    cr.set_source_rgba(0, 0, 0, 0.25)  # weave lines
    cr.set_line_width(w * 0.025)
    for k in (0.33, 0.66):
        cr.move_to(cx - w / 2 + (w * 0.12) * k, top + h * k)
        cr.line_to(cx + w / 2 - (w * 0.12) * k, top + h * k)
        cr.stroke()


def draw(cr, size, count=360, ball=0.08, seed=11, camera=3.2, tall=1.18, taper=0.45, n_strings=6):
    rng = random.Random(seed)
    balls = pack_sphere(count, ball, rng)
    colours = [NINE[k % 9] for k in range(len(balls))]
    rng.shuffle(colours)
    proj = []
    for (x, y, z), c in zip(balls, colours):
        # balloon shape: taller, narrower towards the bottom (y > 0 is down)
        narrow = 1 - taper * max(0.0, y)
        x, z, y = x * narrow, z * narrow, y * tall
        k = camera / (camera - z)
        proj.append((z, x * k, y * k, ball * k, c))
    proj.sort()
    zs = [p[0] for p in proj]
    zmin, zmax = min(zs), max(zs)
    # place: the cluster in the upper part of the icon
    height = max(abs(py) + pr for _, _, py, pr, _ in proj)
    scale = size * 0.37 / height
    cx, cy = size / 2, size * 0.38
    # strings from under the cluster to the basket (drawn first: behind)
    basket_top, basket_w = size * 0.87, size * 0.17
    # strings: from balloons spread along the underside to the basket's rim
    low = [p for p in proj if p[2] > 0.35 * max(q[2] for q in proj)]
    low.sort(key=lambda p: p[1])
    picks = [low[round(k * (len(low) - 1) / (n_strings - 1))] for k in range(n_strings)]
    cr.set_source_rgb(*STRING)
    cr.set_line_width(size * 0.005)
    for k, (_, px, py, _, _) in enumerate(picks):
        rim_x = cx - basket_w * 0.48 + basket_w * 0.96 * k / (n_strings - 1)
        cr.move_to(cx + px * scale, cy + py * scale)
        cr.line_to(rim_x, basket_top)
        cr.stroke()
    for z, px, py, pr, c in proj:
        depth = (zmax - z) / (zmax - zmin or 1)
        balloon(cr, cx + px * scale, cy + py * scale, pr * scale, c, depth)
    person_in_basket(cr, cx, basket_top, basket_w)



def render(path_png=None, path_svg=None, size=1024):
    surface = cairo.SVGSurface(str(path_svg), size, size) if path_svg else cairo.ImageSurface(cairo.FORMAT_ARGB32, size, size)
    draw(cairo.Context(surface), size)
    if path_png:
        surface.write_to_png(str(path_png))
    surface.finish()


if __name__ == "__main__":
    render(path_png=HERE / "icon.png")
    render(path_svg=HERE / "icon.svg")
    print(f"Wrote {HERE / 'icon.png'} and {HERE / 'icon.svg'}")
