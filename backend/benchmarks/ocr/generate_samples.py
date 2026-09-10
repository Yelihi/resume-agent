import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUTPUT = Path(__file__).parent / "generated"
FONT = Path("/System/Library/Fonts/AppleSDGothicNeo.ttc")
LINES = [
    "김개발 | Backend Engineer",
    "2023.01 - 2025.08",
    "React TypeScript Next.js FastAPI",
    "응답 시간을 35% 단축하고 오류율을 1.2%로 개선",
]
TOKENS = ["2023.01", "2025.08", "React", "TypeScript", "Next.js", "FastAPI", "35%", "1.2%"]


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGB", (1600, 1000), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(str(FONT), 48)
    truth_lines = []
    y = 100
    for text in LINES:
        draw.text((100, y), text, font=font, fill="black")
        left, top, right, bottom = draw.textbbox((100, y), text, font=font)
        truth_lines.append({"text": text, "bbox": [left, top, right - left, bottom - top]})
        y += 150

    variants = {
        "clean.png": image,
        "compressed.jpg": image,
        "low_resolution.png": image.resize((800, 500)).resize(image.size),
        "blurred.png": image.filter(ImageFilter.GaussianBlur(1.2)),
        "skewed.png": image.rotate(2, resample=Image.Resampling.BICUBIC, fillcolor="white"),
    }
    for name, variant in variants.items():
        options = {"quality": 45} if name.endswith(".jpg") else {}
        variant.save(OUTPUT / name, **options)

    truth = {
        "text": "\n".join(LINES),
        "tokens": TOKENS,
        "lines": truth_lines,
        "samples": list(variants),
    }
    (OUTPUT / "truth.json").write_text(json.dumps(truth, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
