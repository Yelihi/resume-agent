from benchmarks.ocr.paddle_benchmark import parse_result


def test_parse_result_converts_boxes_to_common_line_shape() -> None:
    payload = {
        "res": {
            "rec_texts": ["React", "2025.08"],
            "rec_scores": [0.9, 0.8],
            "rec_boxes": [[10, 20, 50, 40], [10, 50, 70, 80]],
        }
    }

    assert parse_result(payload) == [
        {"text": "React", "bbox": [10, 20, 40, 20], "confidence": 90.0},
        {"text": "2025.08", "bbox": [10, 50, 60, 30], "confidence": 80.0},
    ]
