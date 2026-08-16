#!/usr/bin/env python3
"""Compose docs/social-preview.png - fully self-drawn, no AI background needed."""
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
W, H = 1280, 640
NAVY_TOP = (16, 22, 52)
NAVY_BOT = (6, 9, 24)
GOLD = (201, 162, 39)
GOLD_SOFT = (232, 205, 128)
TEXT = (245, 247, 255)
SUBTEXT = (208, 216, 246)

TITLE = "dsh-agent-conductor"
SUB_EN = "Dispatch work to 11 external agent CLIs from inside your DSH session"
SUB_ZH = "在会话里指挥 11 家外部 agent CLI —— Codex · Claude Code · TraeCode 派活秒回"
TAGS = ["Zero-install skill", "11 agent CLIs", "Auto-triggered", "Headless dispatch"]

FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
FONT_REG = "/System/Library/Fonts/Supplemental/Arial.ttf"
FONT_CJK = "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"


def main():
    random.seed(42)
    img = Image.new("RGB", (W, H))
    px = img.load()
    for y in range(H):
        t = y / H
        r = round(NAVY_TOP[0] + (NAVY_BOT[0] - NAVY_TOP[0]) * t)
        g = round(NAVY_TOP[1] + (NAVY_BOT[1] - NAVY_TOP[1]) * t)
        b = round(NAVY_TOP[2] + (NAVY_BOT[2] - NAVY_TOP[2]) * t)
        for x in range(W):
            px[x, y] = (r, g, b)

    for _ in range(140):
        x, y = random.randint(0, W - 1), random.randint(0, H - 1)
        s = random.choice([1, 1, 1, 2])
        a = random.randint(30, 140)
        for dx in range(-s, s + 1):
            for dy in range(-s, s + 1):
                if 0 <= x + dx < W and 0 <= y + dy < H:
                    r0, g0, b0 = px[x + dx, y + dy]
                    px[x + dx, y + dy] = (
                        min(255, r0 + GOLD[0] * a // 255),
                        min(255, g0 + GOLD[1] * a // 255),
                        min(255, b0 + GOLD[2] * a // 255),
                    )

    draw = ImageDraw.Draw(img, "RGBA")
    spheres = [(1000, 190, 92), (1090, 330, 62), (935, 415, 54), (1160, 470, 44)]
    for cx, cy, r in spheres:
        glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        for i in range(r * 2, 0, -2):
            gd.ellipse((cx - i, cy - i, cx + i, cy + i), fill=GOLD + (6,))
        img = Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")
        draw = ImageDraw.Draw(img, "RGBA")
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), outline=GOLD + (110,), width=2)
        if r > 80:
            draw.line(
                (cx - r // 3, cy + r // 10, cx - r // 10, cy + r // 3, cx + r // 3, cy - r // 3),
                fill=GOLD_SOFT + (200,), width=5,
            )
        elif r > 55:
            draw.line((cx - r // 4, cy, cx + r // 4, cy), fill=GOLD_SOFT + (190,), width=4)
            draw.line((cx, cy - r // 4, cx, cy + r // 4), fill=GOLD_SOFT + (190,), width=4)
        else:
            draw.ellipse((cx - r // 5, cy - r // 5, cx + r // 5, cy + r // 5), fill=GOLD_SOFT + (200,))
        draw.ellipse((cx - r // 3, cy - r // 2, cx + r // 3, cy - r // 6), fill=(255, 255, 255, 26))

    x = 64
    draw.rectangle((x, 208, x + 8, 276), fill=GOLD)
    title_font = ImageFont.truetype(FONT_BOLD, 52)
    en_font = ImageFont.truetype(FONT_REG, 25)
    cjk_font = ImageFont.truetype(FONT_CJK, 22)
    tag_font = ImageFont.truetype(FONT_CJK, 16)
    draw.text((x + 26, 200), TITLE, font=title_font, fill=TEXT)
    draw.text((x + 26, 272), SUB_EN, font=en_font, fill=SUBTEXT)
    draw.text((x + 26, 312), SUB_ZH, font=cjk_font, fill=GOLD_SOFT)

    tx, ty = x + 26, 380
    for label in TAGS:
        tw = draw.textlength(label, font=tag_font) + 24
        th = 30
        draw.rounded_rectangle((tx, ty, tx + tw, ty + th), radius=15, outline=GOLD + (150,), width=1)
        draw.text((tx + 12, ty + 6), label, font=tag_font, fill=SUBTEXT)
        tx += tw + 12

    out = ROOT / "docs" / "social-preview.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(out)
    print("wrote " + str(out) + " (" + str(W) + "x" + str(H) + ")")


if __name__ == "__main__":
    main()