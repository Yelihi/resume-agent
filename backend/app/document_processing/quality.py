"""Assess extraction signals, not semantic correctness against the original image."""
from .models import ExtractionIssue, ExtractionReport, FlowDocument, PageDocument


def looks_corrupted(text: str) -> bool:
    if any(char == "\ufffd" or "\ue000" <= char <= "\uf8ff" or "\u0080" <= char <= "\u009f" or (ord(char) < 32 and char not in "\t\n\r") for char in text):
        return True
    # ponytail: heuristic only; valid-looking substitutions need image comparison or human review.
    suspicious = sum(char in "ÀÁÂÃÄÅÈÉÊËÌÍÎÏÐÑÒÓÔÕÖÙÚÛÜÝÞßàáâãäåèéêëìíîïðñòóôõöùúûüýþÿ¤¦¨¬±´¸¼½¾" for char in text)
    return suspicious >= 5 and suspicious / max(len(text.strip()), 1) > 0.2


def assess_document(document: PageDocument | FlowDocument, issues: list[ExtractionIssue] | None = None):
    findings = list(issues if issues is not None else document.extraction.issues if document.extraction else [])
    pages = [(p.pageNumber, p.blocks) for p in document.pages] if isinstance(document, PageDocument) else [(None, document.blocks)]
    for page_number, blocks in pages:
        for block in blocks:
            for line in block.lines:
                corrupted = looks_corrupted(line.text)
                uncertain = bool(getattr(line, "uncertainWords", []))
                if corrupted or uncertain:
                    issue = ExtractionIssue(stage="assessment", code="SUSPECT_TEXT" if corrupted else "LOW_OCR_CONFIDENCE",
                        message="추출한 글자가 깨졌을 가능성이 있습니다." if corrupted else "인식이 불확실한 글자를 원본과 비교해 주세요.",
                        pageNumber=page_number, lineIds=[line.lineId], bbox=getattr(line, "bbox", None))
                    if issue not in findings:
                        findings.append(issue)
    status = "needs_review" if any(not issue.recovered for issue in findings) else "recovered" if findings else "complete"
    report = ExtractionReport(status=status, issues=findings, confirmed=bool(document.extraction and document.extraction.confirmed))
    return document.model_copy(update={"extraction": report})


def require_reviewable(document: PageDocument | FlowDocument) -> None:
    report = assess_document(document).extraction
    if report.status == "needs_review" and not report.confirmed:
        raise ValueError("추출된 내용을 원본과 비교하고 확인한 뒤 검토를 시작해 주세요.")
