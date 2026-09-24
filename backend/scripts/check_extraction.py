"""Local-only regression check. Keep the input and expected JSON outside git."""
import argparse
import json
import time
import unicodedata
from pathlib import Path

from app.document_processing.flow import extract_docx, extract_txt
from app.document_processing.ocr import extract_image, extract_pdf_with_ocr


def check(document, expected: dict) -> list[str]:
    pages = ["\n".join(line.text for block in page.blocks for line in block.lines) for page in document.pages] if hasattr(document, "pages") else [document.text]
    failures = []
    if len(pages) != expected["pageCount"]:
        failures.append("page count mismatch")
    if not expected["anchors"]:
        raise ValueError("at least one manually verified anchor is required")
    for index, anchor in enumerate(expected["anchors"], 1):
        page = anchor["page"]
        text = anchor["text"]
        if not isinstance(page, int) or page < 1 or not isinstance(text, str) or not text.strip():
            raise ValueError("anchors require a positive page number and nonempty text")
        normalize = lambda value: "".join(unicodedata.normalize("NFC", value).split())
        if page > len(pages) or normalize(text) not in normalize(pages[page - 1]):
            failures.append(f"anchor {index} missing on page {page}")
    return failures


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("expected", type=Path, help="JSON: pageCount and anchors [{page, text}]")
    args = parser.parse_args()
    expected = json.loads(args.expected.read_text(encoding="utf-8"))
    suffix = args.input.suffix.lower()
    extractors = {".pdf": extract_pdf_with_ocr, ".docx": extract_docx, ".txt": extract_txt,
                  **{ext: extract_image for ext in (".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff")}}
    if suffix not in extractors:
        parser.error("unsupported file extension")
    started = time.monotonic()
    document = extractors[suffix](args.input.read_bytes())
    failures = check(document, expected)
    print(json.dumps({"passed": not failures, "seconds": round(time.monotonic() - started, 2),
                      "anchors": len(expected["anchors"]), "failures": failures}))
    raise SystemExit(1 if failures else 0)


if __name__ == "__main__":
    main()
