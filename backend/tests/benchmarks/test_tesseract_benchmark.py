from benchmarks.ocr.tesseract_benchmark import parse_tsv


def test_parse_tsv_groups_words_into_lines_and_unions_bbox() -> None:
    tsv = """level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext
5\t1\t1\t1\t1\t1\t10\t20\t30\t10\t90\tReact
5\t1\t1\t1\t1\t2\t45\t20\t40\t10\t80\tFastAPI
5\t1\t1\t1\t2\t1\t10\t40\t50\t10\t70\t2025.08
"""

    lines = parse_tsv(tsv)

    assert lines == [
        {"text": "React FastAPI", "bbox": [10, 20, 75, 10], "confidence": 85.0},
        {"text": "2025.08", "bbox": [10, 40, 50, 10], "confidence": 70.0},
    ]
