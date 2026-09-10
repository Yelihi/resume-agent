import pytest

from benchmarks.ocr.metrics import bbox_iou, character_error_rate, key_token_recall


def test_character_error_rate_uses_edit_distance() -> None:
    assert character_error_rate("React", "Reaxt") == pytest.approx(0.2)
    assert character_error_rate("A B", "ab") == 0


def test_key_token_recall_is_case_insensitive() -> None:
    assert key_token_recall("react and FASTAPI", ["React", "FastAPI", "2025.08"]) == pytest.approx(2 / 3)


def test_bbox_iou() -> None:
    assert bbox_iou((0, 0, 10, 10), (5, 5, 10, 10)) == pytest.approx(25 / 175)
    assert bbox_iou((0, 0, 1, 1), (2, 2, 1, 1)) == 0
