import asyncio
import os
from io import BytesIO

import httpx
import pymupdf
import pytest
from docx import Document
from PIL import Image, ImageDraw, ImageFont

from app.main import app


def request(method: str, path: str, **kwargs) -> httpx.Response:
    async def send() -> httpx.Response:
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.request(method, path, **kwargs)

    return asyncio.run(send())


def assert_flow_invariants(document: dict) -> None:
    encoded = document["text"].encode("utf-16-le")
    lines = [line for block in document["blocks"] for line in block["lines"]]
    assert len({line["lineId"] for line in lines}) == len(lines)
    for line in lines:
        resolved = encoded[line["startOffset"] * 2 : line["endOffset"] * 2].decode("utf-16-le")
        assert resolved == line["text"]


def assert_page_invariants(document: dict) -> None:
    lines = [line for page in document["pages"] for block in page["blocks"] for line in block["lines"]]
    assert len({line["lineId"] for line in lines}) == len(lines)
    for line in lines:
        box = line["bbox"]
        assert 0 <= box["x"] < 1 and 0 <= box["y"] < 1
        assert box["width"] > 0 and box["height"] > 0
        assert box["x"] + box["width"] <= 1
        assert box["y"] + box["height"] <= 1


def test_all_non_ocr_formats_cross_the_real_http_boundary() -> None:
    direct = request("POST", "/api/resumes/extract/text", json={"text": "A😀B\nsecond"})
    txt = request("POST", "/api/resumes/extract/txt", files={"file": ("r.txt", b"one\ntwo")})

    word = Document()
    word.add_paragraph("DOCX line")
    word_bytes = BytesIO()
    word.save(word_bytes)
    docx = request("POST", "/api/resumes/extract/docx", files={"file": ("r.docx", word_bytes.getvalue())})

    pdf_source = pymupdf.open()
    pdf_source.new_page().insert_text((72, 72), "PDF line")
    pdf = request("POST", "/api/resumes/extract/pdf", files={"file": ("r.pdf", pdf_source.tobytes())})

    for response in (direct, txt, docx, pdf):
        assert response.status_code == 200
        assert response.json()["errors"] == []
    for response in (direct, txt, docx):
        assert_flow_invariants(response.json()["document"])
    assert_page_invariants(pdf.json()["document"])


@pytest.mark.ocr
@pytest.mark.skipif(os.getenv("RUN_OCR_TESTS") != "1", reason="set RUN_OCR_TESTS=1 for real model")
def test_real_image_ocr_crosses_http_boundary() -> None:
    image = Image.new("RGB", (1400, 300), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype("/System/Library/Fonts/AppleSDGothicNeo.ttc", 64)
    draw.text((80, 80), "FastAPI 2025.08 이력서", font=font, fill="black")
    raw = BytesIO()
    image.save(raw, "PNG")

    response = request("POST", "/api/resumes/extract/image", files={"file": ("resume.png", raw.getvalue())})

    assert response.status_code == 200
    assert_page_invariants(response.json()["document"])
    text = " ".join(
        line["text"]
        for page in response.json()["document"]["pages"]
        for block in page["blocks"]
        for line in block["lines"]
    )
    assert "FastAPI" in text
    assert "2025.08" in text
