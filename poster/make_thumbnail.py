# Refresh the pptx's embedded thumbnail (what File Explorer shows) from poster/preview.png.
#   python poster/make_thumbnail.py        (run after poster/export.ps1)
import io
from pathlib import Path

from PIL import Image
from pptx import Presentation

POSTER = Path(__file__).resolve().parent
pptx = POSTER / 'GINKGO poster for URBIEE26.pptx'
prs = Presentation(str(pptx))
part = next(p for p in prs.part.package.iter_parts() if str(p.partname) == '/docProps/thumbnail.jpeg')
im = Image.open(POSTER / 'preview.png').convert('RGB')
im.thumbnail((256, 362))
buf = io.BytesIO(); im.save(buf, 'JPEG', quality=85)
part._blob = buf.getvalue()
prs.save(str(pptx))
print('thumbnail', im.size)
