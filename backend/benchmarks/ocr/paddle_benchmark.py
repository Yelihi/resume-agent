import json
import os
import time
from pathlib import Path

from .metrics import bbox_iou, character_error_rate, key_token_recall

ROOT = Path(__file__).parent


def parse_result(payload: dict) -> list[dict]:
    result = payload["res"]
    lines = []
    for text, score, box in zip(
        result["rec_texts"],
        result["rec_scores"],
        result["rec_boxes"],
        strict=True,
    ):
        x0, y0, x1, y1 = [int(value) for value in box]
        lines.append(
            {
                "text": text,
                "bbox": [x0, y0, x1 - x0, y1 - y0],
                "confidence": float(score) * 100,
            }
        )
    return lines


def _line_iou(expected: list[dict], actual: list[dict]) -> float:
    pairs = zip(expected, actual, strict=False)
    values = [bbox_iou(tuple(reference["bbox"]), tuple(candidate["bbox"])) for reference, candidate in pairs]
    return sum(values) / len(expected) if values else 0.0


def main() -> None:
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    from paddleocr import PaddleOCR

    generated = ROOT / "generated"
    truth = json.loads((generated / "truth.json").read_text(encoding="utf-8"))
    started = time.perf_counter()
    engine = PaddleOCR(
        text_detection_model_name="PP-OCRv5_mobile_det",
        text_recognition_model_name="korean_PP-OCRv5_mobile_rec",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
    )
    initialization_seconds = time.perf_counter() - started
    samples = []
    for name in truth["samples"]:
        started = time.perf_counter()
        result = list(engine.predict(str(generated / name)))[0]
        elapsed = time.perf_counter() - started
        lines = parse_result(result.json)
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
    report = {
        "engine": "paddleocr-mobile-det",
        "initializationSeconds": initialization_seconds,
        "samples": samples,
    }
    reports = ROOT / "reports"
    reports.mkdir(exist_ok=True)
    (reports / "paddleocr-mobile.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
