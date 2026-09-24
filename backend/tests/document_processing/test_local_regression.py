from app.document_processing.flow import extract_text
from app.document_processing.ocr import _looks_corrupted
from scripts.check_extraction import check


def test_local_anchors_detect_changed_numbers_and_missing_pages():
    document = extract_text("응답 시간을 100ms로 개선")
    expected = {"pageCount": 1, "anchors": [{"page": 1, "text": "100ms로 개선"}]}
    assert check(document, expected) == []
    expected["anchors"][0]["text"] = "10ms로 개선"
    assert check(document, expected) == ["anchor 1 missing on page 1"]
    expected["anchors"][0]["page"] = 2
    assert check(document, expected) == ["anchor 1 missing on page 2"]


def test_pdf_control_characters_trigger_recovery():
    assert _looks_corrupted("AI\x00 development\x08")
    assert not _looks_corrupted("AI\tdevelopment\nReact")
