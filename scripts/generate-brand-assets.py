"""Optional asset regeneration: Python 3 + Pillow. Not required by the app build.
Uses DejaVu Sans (FONT_DIR can override its location).
"""
from pathlib import Path
import os
from PIL import Image, ImageDraw, ImageFont

PUBLIC = Path(__file__).resolve().parents[1] / 'public'
FONT_DIR = Path(os.environ.get('FONT_DIR', '/usr/share/fonts/truetype/dejavu'))
BLUE, ORANGE, WHITE = '#0058a4', '#ff6600', '#ffffff'

def logo(size):
    image = Image.new('RGB', (1024, 1024), BLUE)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((330, 245, 445, 665), radius=15, fill=WHITE)
    draw.rounded_rectangle((579, 245, 694, 665), radius=15, fill=WHITE)
    draw.rounded_rectangle((330, 745, 694, 785), radius=20, fill=ORANGE)
    return image.resize((size, size), Image.Resampling.LANCZOS)

for filename, size in [('favicon.png',96), ('apple-touch-icon.png',180), ('icon-192.png',192), ('icon-512.png',512)]:
    logo(size).save(PUBLIC / filename, optimize=True)

image = Image.new('RGB', (1200,630), '#f5f8fc')
draw = ImageDraw.Draw(image)
draw.rectangle((0,0,1199,11), fill=ORANGE)
image.paste(logo(104), (72,65))
def text(x,y,value,size,color=BLUE,bold=False):
    font=ImageFont.truetype(str(FONT_DIR / ('DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf')), size)
    draw.text((x,y), value, font=font, fill=color)
text(202,68,'Campus Pause',42,bold=True)
text(204,124,'FOR BMCC STUDENTS',20,color='#526780')
text(70,222,'Know before you go.',72,bold=True)
text(74,335,'Days off. Schedule changes. A heads-up the night before.',30,color='#344f6e')
text(74,415,'Free reminders. No account needed.',27,color='#344f6e')
draw.line((74,490,1126,490),fill='#cbd6e5',width=2)
text(74,518,'pause.zerofadecloud.com',26,bold=True)
text(74,565,'Independent student project · Not affiliated with BMCC or CUNY.',17,color='#526780')
image.quantize(colors=128).save(PUBLIC / 'share-card.png',optimize=True)
(PUBLIC / 'icon.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="180" fill="#0058a4"/><g fill="white"><rect x="330" y="245" width="115" height="420" rx="15"/><rect x="579" y="245" width="115" height="420" rx="15"/></g><rect x="330" y="745" width="364" height="40" rx="20" fill="#ff6600"/></svg>\n')
