"""Builds a small PDF using what the PDF import handles (PyMuPDF writes it,
so no binary file is kept in the repository)."""

import io

from PIL import Image


def build(path):
    import pymupdf as fz

    doc = fz.open()
    W, H = 720, 405  # 16:9
    buf = io.BytesIO()
    Image.new("RGB", (100, 50), "blue").save(buf, format="PNG")
    picture = buf.getvalue()

    def common(page, n):
        page.draw_rect(fz.Rect(650, 10, 700, 40), color=None, fill=(0.8, 0, 0))  # a logo on every page
        page.insert_text((680, 395), f"{n} / 3", fontsize=9, fontname="helv")  # the page number

    # 1. text, shapes, a picture, math, a dense drawing
    p = doc.new_page(width=W, height=H)
    common(p, 1)
    p.insert_text((40, 50), "Results", fontsize=24, fontname="hebo")  # bold: the title
    p.insert_text((40, 100), "Plain text and", fontsize=14, fontname="helv")
    p.insert_text((150, 100), "italic", fontsize=14, fontname="heit")
    p.insert_text((40, 130), "Red words", fontsize=14, fontname="helv", color=(1, 0, 0))
    p.insert_text((40, 170), "abc = xyz", fontsize=14, fontname="symb")  # a math font
    p.draw_rect(fz.Rect(40, 200, 200, 260), color=(0, 0, 0), fill=(0.2, 0.6, 0.3), width=2)
    p.draw_oval(fz.Rect(220, 200, 280, 260), color=None, fill=(1, 0.8, 0))
    p.draw_line(fz.Point(40, 290), fz.Point(280, 290), color=(0.2, 0.2, 0.2), width=1.5)
    p.insert_image(fz.Rect(320, 80, 520, 180), stream=picture)
    for i in range(80):  # a "plot": many small segments
        p.draw_line(fz.Point(320 + i * 4, 300), fz.Point(322 + i * 4, 300 - (i % 7) * 6), color=(0, 0, 1), width=0.5)

    # 2 and 3: one frame revealed in two steps (Beamer overlay)
    for n, items in ((2, ["First point"]), (3, ["First point", "Second point"])):
        p = doc.new_page(width=W, height=H)
        common(p, n)
        p.insert_text((40, 50), "Steps", fontsize=24, fontname="hebo")
        for k, t in enumerate(items):
            p.insert_text((60, 120 + 40 * k), t, fontsize=16, fontname="helv")
    doc.set_metadata({"title": "PDF Deck", "author": "Ana"})
    doc.save(path)
    return path
