import re


from app.document_processing.models import FlowDocument, PageDocument

from .contracts import ModuleResult, SpellDiagnostic


_RULES = (
    (re.compile(r" {2,}"), lambda _: " ", "연속된 공백을 하나로 줄일 수 있습니다."),
    (re.compile(r" +([.,!?;:])"), lambda match: match.group(1), "문장부호 앞의 공백을 제거할 수 있습니다."),
)


def _line_items(document: PageDocument | FlowDocument) -> list[tuple[str, str]]:
    if isinstance(document, PageDocument):
        return [
            (line.lineId, line.text)
            for page in document.pages
            for block in page.blocks
            for line in block.lines
        ]
    return [(line.lineId, line.text) for block in document.blocks for line in block.lines]


def check_spelling(document: PageDocument | FlowDocument) -> ModuleResult[list[SpellDiagnostic]]:
    diagnostics: list[SpellDiagnostic] = []
    for line_id, text in _line_items(document):
        for pattern, replacement, reason in _RULES:
            diagnostics.extend(
                SpellDiagnostic(
                    lineId=line_id,
                    quote=match.group(0),
                    replacement=replacement(match),
                    reason=reason,
                )
                for match in pattern.finditer(text)
            )
    return ModuleResult(moduleKey="spellCheck", output=diagnostics, errors=[])
