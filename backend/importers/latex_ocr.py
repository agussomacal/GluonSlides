"""Pictures of equations back to LaTeX (an optional component, extras.py).

The model is LaTeX-OCR's (pix2tex, MIT) as converted to ONNX by
RapidLaTeXOCR (Apache-2.0): an image sizer, an encoder and a decoder, plus
the tokens' vocabulary. This is their inference (rapid_latex_ocr 0.0.9)
redone with numpy and Pillow only (no OpenCV, no tokenizers library), with
greedy decoding, so the download stays onnxruntime + numpy + the models.

    reader = EquationReader(model_dir)        # the four files of MODEL_FILES
    latex, sure = reader.read(pil_image)     # ("\\mathcal{P}(u,y)=0", -0.05); sure: 0 is certain
"""

import json
import os
import re

MODEL_FILES = {  # name -> (size in bytes, sha256), from the RapidLaTeXOCR v0.0.0 release
    "image_resizer.onnx": (38967751, "e0b075c39700f64d50400f39c8fc186bbb3b5d84d31864008313f376603aca9d"),
    "encoder.onnx": (89008136, "01bf5dc25539ca0cd5b1bd29296ea495977a6ba5f629dc4178277809d26e5e7d"),
    "decoder.onnx": (50952726, "bd695497bf1b22279b7626f5916c79226e1e244c84355f8da7edfd2d921d0072"),
    "tokenizer.json": (24174, "1dc27b18d6a518d0d5ff3f4bb7bd98521fe80ad39e5b2a246d4109f1bb9d5019"),
}
MODEL_URL = "https://github.com/RapidAI/RapidLaTeXOCR/releases/download/v0.0.0/"

MAX_DIMS, MIN_DIMS = (672, 192), (32, 32)
BOS, EOS, MAX_TOKENS = 1, 2, 512
MEAN, STD = 0.7931, 0.1738


class EquationReader:
    def __init__(self, model_dir):
        import onnxruntime as ort
        opts = ort.SessionOptions()
        opts.log_severity_level = 3
        load = lambda name: ort.InferenceSession(os.path.join(model_dir, name), sess_options=opts,
                                                 providers=["CPUExecutionProvider"])
        self.resizer = load("image_resizer.onnx")
        self.encoder = load("encoder.onnx")
        self.decoder = load("decoder.onnx")
        with open(os.path.join(model_dir, "tokenizer.json"), encoding="utf-8") as f:
            vocab = json.load(f)["model"]["vocab"]
        self.tokens = {i: t for t, i in vocab.items()}

    # ---------- the picture as the model wants it ----------

    @staticmethod
    def _crop_pad(img, divable=32):
        """Grey, ink dark on light, cropped to the ink, padded to a multiple of 32."""
        import numpy as np
        from PIL import Image
        data = np.array(img.convert("LA"))
        if data[..., -1].var() == 0:
            g = data[..., 0].astype(np.float32)
        else:
            g = (255 - data[..., -1]).astype(np.float32)
        lo, hi = g.min(), g.max()
        if hi - lo < 1:
            return None
        g = (g - lo) / (hi - lo) * 255
        if g.mean() > 128:
            ink = g < 128
        else:
            ink = g > 128
            g = 255 - g
        ys, xs = np.nonzero(ink)
        if not len(xs):
            return None
        crop = g[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        h, w = crop.shape
        W, H = (-(-w // divable)) * divable, (-(-h // divable)) * divable
        out = Image.new("L", (W, H), 255)
        out.paste(Image.fromarray(crop.astype(np.uint8)).convert("L"), (0, 0))
        return out

    @staticmethod
    def _min_max(img):
        from PIL import Image
        ratios = [a / b for a, b in zip(img.size, MAX_DIMS)]
        if any(r > 1 for r in ratios):
            k = max(ratios)
            img = img.resize((max(1, int(img.size[0] / k)), max(1, int(img.size[1] / k))), Image.BILINEAR)
        size = (max(img.size[0], MIN_DIMS[0]), max(img.size[1], MIN_DIMS[1]))
        if size != img.size:
            padded = Image.new("L", size, 255)
            padded.paste(img, (0, 0))
            img = padded
        return img

    @staticmethod
    def _tensor(img):
        import numpy as np
        a = (np.array(img.convert("L"), dtype=np.float32) - MEAN * 255) / (STD * 255)
        return a[None, None, :, :]

    def _sized(self, img):
        """The model's own resizing loop: scaled until the sizer agrees with the width."""
        import numpy as np
        from PIL import Image
        start = self._crop_pad(img)
        if start is None:
            return None
        base = self._min_max(start)
        r, w, h = 1.0, base.size[0], base.size[1]
        final = None
        for _ in range(10):
            h = int(h * r)
            resized = base.resize((max(1, w), max(1, h)), Image.BILINEAR if r > 1 else Image.LANCZOS)
            padded = self._crop_pad(self._min_max(resized)) or self._min_max(resized)
            final = self._tensor(padded)
            out = self.resizer.run(None, {self.resizer.get_inputs()[0].name: final})[0]
            w = (int(np.argmax(out, axis=-1).flatten()[0]) + 1) * 32
            if w == padded.size[0]:
                break
            r = w / padded.size[0]
        return final

    # ---------- reading ----------

    def read_scored(self, img):
        """(latex, confidence): the mean log-probability of its tokens (0 is sure)."""
        import numpy as np
        x = self._sized(img)
        if x is None:
            return "", float("-inf")
        context = self.encoder.run(None, {self.encoder.get_inputs()[0].name: x})[0]
        names = [i.name for i in self.decoder.get_inputs()]
        out = np.array([[BOS]], dtype=np.int64)
        logp = []
        for _ in range(MAX_TOKENS):
            mask = np.ones_like(out, dtype=bool)
            logits = self.decoder.run(None, dict(zip(names, [out, mask, context])))[0][:, -1, :][0]
            nxt = int(np.argmax(logits))
            shifted = logits - logits.max()
            logp.append(float(shifted[nxt] - np.log(np.exp(shifted).sum())))
            out = np.concatenate([out, [[nxt]]], axis=1)
            if nxt == EOS:
                break
        text = "".join(self.tokens.get(int(t), "") for t in out[0, 1:])
        for special in ("[EOS]", "[BOS]", "[PAD]"):
            text = text.replace(special, "")
        return tidy(text.replace("Ġ", " ").strip()), (sum(logp) / len(logp) if logp else float("-inf"))

    def read(self, img, scales=(1.0, 1.5, 2.0, 3.0)):
        """(latex, confidence) of a picture of one equation: read at a few
        sizes (the model is sensitive to the size of the symbols), the
        reading it is surest of. ('', -inf) if nothing could be read."""
        from PIL import Image
        best = ("", float("-inf"))
        for k in scales:
            im = img if k == 1 else img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS)
            got = self.read_scored(im)
            if got[0] and got[1] > best[1]:
                best = got
        return best

def tidy(s):
    """Spaces the model puts between tokens, removed where LaTeX doesn't need them."""
    text_reg = r"(\\(operatorname|mathrm|text|mathbf)\s?\*? {.*?})"
    names = [x[0].replace(" ", "") for x in re.findall(text_reg, s)]
    s = re.sub(text_reg, lambda m: names.pop(0), s)
    letter, noletter = "[a-zA-Z]", r"[\W_^\d]"
    while True:
        new = re.sub(r"(?!\\ )(%s)\s+?(%s)" % (noletter, noletter), r"\1\2", s)
        new = re.sub(r"(?!\\ )(%s)\s+?(%s)" % (noletter, letter), r"\1\2", new)
        new = re.sub(r"(%s)\s+?(%s)" % (letter, noletter), r"\1\2", new)
        if new == s:
            return s
        s = new
