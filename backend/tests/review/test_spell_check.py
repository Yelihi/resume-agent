from app.document_processing.flow import extract_text
from app.review.spell_check import check_spelling


def test_finds_only_deterministic_spacing_issues_with_line_location() -> None:
    document = extract_text("캐시를  적용했습니다 .\nReact와 TypeScript를 사용했습니다.")

    result = check_spelling(document)

    assert result.moduleKey == "spellCheck"
    assert result.errors == []
    assert [(item.lineId, item.quote, item.replacement) for item in result.output or []] == [
        ("f-l1", "  ", " "),
        ("f-l1", " .", "."),
    ]


def test_does_not_guess_korean_vocabulary_or_grammar() -> None:
    document = extract_text("되와 돼를 구분못할수도 있습니다.")

    result = check_spelling(document)

    assert result.output == []
    assert result.errors == []


def test_clean_document_returns_empty_success_output() -> None:
    document = extract_text("캐시를 적용했습니다.")

    result = check_spelling(document)

    assert result.output == []
    assert result.errors == []
