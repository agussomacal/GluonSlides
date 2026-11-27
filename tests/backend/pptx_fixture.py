"""Builds a small .pptx using each feature the PowerPoint import handles
(tests/backend/test_backend.py; python-pptx writes it, so no binary file
is kept in the repository)."""

import copy
import io

from lxml import etree
from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import PP_ALIGN
from pptx.util import Emu, Inches, Pt

P = "http://schemas.openxmlformats.org/presentationml/2006/main"
P14 = "http://schemas.microsoft.com/office/powerpoint/2010/main"


def png(colour, size=(200, 100)):
    buf = io.BytesIO()
    Image.new("RGB", size, colour).save(buf, format="PNG")
    buf.seek(0)
    return buf


def build(path):
    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)  # 16:9

    # 1. title slide, dark background
    s1 = prs.slides.add_slide(prs.slide_layouts[0])
    s1.shapes.title.text = "Imported Deck"
    s1.placeholders[1].text = "A subtitle"
    s1.background.fill.solid()
    s1.background.fill.fore_color.rgb = RGBColor(0x10, 0x20, 0x30)

    # 2. content: bullets with levels and formatting
    s2 = prs.slides.add_slide(prs.slide_layouts[1])
    s2.shapes.title.text = "Content"
    body = s2.placeholders[1].text_frame
    body.text = "First point"
    p = body.add_paragraph()
    p.level = 1
    r = p.add_run()
    r.text = "bold sub"
    r.font.bold = True
    p = body.add_paragraph()
    r = p.add_run()
    r.text = "red link"
    r.font.color.rgb = RGBColor(0xFF, 0x00, 0x00)
    r.hyperlink.address = "https://example.org"
    p = body.add_paragraph()
    p.text = "Numbered"
    p._p.get_or_add_pPr().append(etree.SubElement(p._p.get_or_add_pPr(), "{http://schemas.openxmlformats.org/drawingml/2006/main}buAutoNum", type="arabicPeriod"))

    pic = s2.shapes.add_picture(png("blue"), Inches(8), Inches(1.5), width=Inches(4))
    box = s2.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(1), Inches(5), Inches(3), Inches(1))
    box.fill.solid()
    box.fill.fore_color.rgb = RGBColor(0x22, 0x88, 0x44)
    box.line.color.rgb = RGBColor(0, 0, 0)
    box.line.width = Pt(2)
    box.text_frame.text = "In a box"
    box.text_frame.paragraphs[0].alignment = PP_ALIGN.CENTER
    box.text_frame.paragraphs[0].runs[0].font.size = Pt(20)
    oval = s2.shapes.add_shape(MSO_SHAPE.OVAL, Inches(5), Inches(5), Inches(1), Inches(1))
    oval.fill.solid()
    oval.fill.fore_color.rgb = RGBColor(0xFF, 0xCC, 0x00)
    rounded = s2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(6.5), Inches(5), Inches(2), Inches(1))
    rounded.fill.solid()
    rounded.fill.fore_color.rgb = RGBColor(0x88, 0x88, 0xFF)
    line = s2.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(1), Inches(6.8), Inches(4), Inches(6.8))
    line.line.color.rgb = RGBColor(0x33, 0x33, 0x33)
    ln = line.line._get_or_add_ln()
    etree.SubElement(ln, "{http://schemas.openxmlformats.org/drawingml/2006/main}tailEnd", type="triangle")
    tbl = s2.shapes.add_table(2, 2, Inches(9), Inches(5), Inches(3), Inches(1)).table
    for (i, j), t in {(0, 0): "h1", (0, 1): "h2", (1, 0): "a", (1, 1): "b"}.items():
        tbl.cell(i, j).text = t
    grp = s2.shapes.add_group_shape()
    g1 = grp.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(10), Inches(0.2), Inches(0.5), Inches(0.5))
    g1.fill.solid()
    g1.fill.fore_color.rgb = RGBColor(0xAA, 0, 0)
    s2.notes_slide.notes_text_frame.text = "Speaker notes here"

    # click animations: the picture on the 1st click, the oval on the 2nd; the picture leaves on the 3rd
    timing = f'''<p:timing xmlns:p="{P}"><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>
      <p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>
        <p:par><p:cTn id="3" fill="hold"><p:childTnLst><p:par><p:cTn id="4" fill="hold"><p:childTnLst>
          <p:par><p:cTn id="5" presetID="1" presetClass="entr" fill="hold" nodeType="clickEffect"><p:childTnLst>
            <p:set><p:cBhvr><p:cTn id="6"/><p:tgtEl><p:spTgt spid="{pic.shape_id}"/></p:tgtEl></p:cBhvr></p:set>
          </p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>
        <p:par><p:cTn id="7" fill="hold"><p:childTnLst><p:par><p:cTn id="8" fill="hold"><p:childTnLst>
          <p:par><p:cTn id="9" presetID="1" presetClass="entr" fill="hold" nodeType="clickEffect"><p:childTnLst>
            <p:set><p:cBhvr><p:cTn id="10"/><p:tgtEl><p:spTgt spid="{oval.shape_id}"/></p:tgtEl></p:cBhvr></p:set>
          </p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>
        <p:par><p:cTn id="11" fill="hold"><p:childTnLst><p:par><p:cTn id="12" fill="hold"><p:childTnLst>
          <p:par><p:cTn id="13" presetID="1" presetClass="exit" fill="hold" nodeType="clickEffect"><p:childTnLst>
            <p:set><p:cBhvr><p:cTn id="14"/><p:tgtEl><p:spTgt spid="{pic.shape_id}"/></p:tgtEl></p:cBhvr></p:set>
          </p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>
      </p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>'''
    s2._element.append(etree.fromstring(timing))

    # a logo on the "Title and Content" layout: goes on that master slide
    logo = copy.deepcopy(g1._element)
    logo.find(".//{http://schemas.openxmlformats.org/presentationml/2006/main}cNvPr").set("id", "999")
    prs.slide_layouts[1].shapes._spTree.append(logo)

    # sections
    ids = [s.slide_id for s in prs.slides]
    ext = f'''<p:ext xmlns:p="{P}" uri="{{521415D9-36F7-43E2-AB2F-B90AF26B5E84}}"><p14:sectionLst xmlns:p14="{P14}">
        <p14:section name="Opening" id="{{11111111-1111-1111-1111-111111111111}}"><p14:sldIdLst><p14:sldId id="{ids[0]}"/></p14:sldIdLst></p14:section>
        <p14:section name="Main" id="{{22222222-2222-2222-2222-222222222222}}"><p14:sldIdLst><p14:sldId id="{ids[1]}"/></p14:sldIdLst></p14:section>
      </p14:sectionLst></p:ext>'''
    root = prs.part._element
    ext_lst = root.find(f"{{{P}}}extLst")
    if ext_lst is None:
        ext_lst = etree.SubElement(root, f"{{{P}}}extLst")
    ext_lst.append(etree.fromstring(ext))

    prs.core_properties.title = "Imported Deck"
    prs.core_properties.author = "Ana"
    prs.save(path)
    return path
