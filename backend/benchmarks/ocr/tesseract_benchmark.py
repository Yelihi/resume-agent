import csv
import io
import json
import subprocess
import time
from pathlib import Path

from .metrics import bbox_iou, character_error_rate, key_token_recall

ROOT = Path(__file__).parent


def parse_tsv(tsv: str) -> list[dict]:
    grouped: dict[tuple[int, int, int, int], list[dict]] = {}
    for row in csv.DictReader(io.StringIO(tsv), delimiter="\t"):
        if row.get("level") != "5" or not row.get("text", "").strip():
            continue
        key = tuple(int(row[name]) for name in ("page_num", "block_num", "par_num", "line_num"))
        grouped.setdefault(key, []).append(row)

    lines = []
    for words in grouped.values():
        left = min(int(word["left"]) for word in words)
        top = min(int(word["top"]) for word in words)
        right = max(int(word["left"]) + int(word["width"]) for word in words)
        bottom = max(int(word["top"]) + int(word["height"]) for word in words)
        lines.append(
            {
                "text": " ".join(word["text"] for word in words),
                "bbox": [left, top, right - left, bottom - top],
                "confidence": sum(float(word["conf"]) for word in words) / len(words),
            }
        )
    return lines


def _line_iou(expected: list[dict], actual: list[dict]) -> float:
    pairs = zip(expected, actual, strict=False)
    values = [bbox_iou(tuple(reference["bbox"]), tuple(candidate["bbox"])) for reference, candidate in pairs]
    return sum(values) / len(expected) if values else 0.0


def main() -> None:
    generated = ROOT / "generated"
    truth = json.loads((generated / "truth.json").read_text(encoding="utf-8"))
    samples = []
    for name in truth["samples"]:
        started = time.perf_counter()
        result = subprocess.run(
            ["tesseract", str(generated / name), "stdout", "-l", "kor+eng", "--psm", "6", "tsv"],
            check=True,
            capture_output=True,
            text=True,
        )
        elapsed = time.perf_counter() - started
        lines = parse_tsv(result.stdout)
        recognized = "\n".join(line["text"] for line in lines)
        samples.append(
            {
                "name": name,
                "seconds": elapsed,
                "characterErrorRate": character_error_rate(truth["text"], recognized),
                "keyTokenRecall": key_token_recall(recognized, truth["tokens"]),
                "averageLineBboxIoU": _line_iou(truth["lines"], lines),
                "lines": lines,
            }
        )
    report = {"engine": "tesseract", "samples": samples}
    reports = ROOT / "reports"
    reports.mkdir(exist_ok=True)
    (reports / "tesseract.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
