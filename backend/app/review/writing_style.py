"""IMG_7606 candidates. Only exact, local contractions can become rewrites."""
import re

from app.document_processing.models import FlowDocument, PageDocument
from .contracts import SuggestionDTO

_PATTERNS = {
    "continue": r"이어 봅니다", "contrast": r"하지 않고", "structure": r"하는 구조입니다",
    "judgment": r"판정했습니다", "only": r"만(?=\s|[.,]|$)", "result": r"남는 결과를",
    "definition": r"그것이 곧", "effect": r"따라옵니다", "record": r"기록으로 남겼습니다",
    "knowledge": r"임을 압니다", "sequence": r"이 순서로 갔습니다",
    "template": r"템플릿을 통해 단축", "analysis": r"데이터에 대한 분석을 수행",
    "importance": r"중요한 의미를 가집니다", "passive": r"되었습니다|보여집니다",
    "praise": r"혁신적인|획기적인|탁월한", "experience": r"(?:다양한|풍부한) 경험",
    "connector": r"또한|나아가|결론적으로", "contribution": r"에 기여했습니다",
    "dash": r"[—–]", "emoji": r"^\s*(?:#+\s*)?[\U0001F300-\U0001FAFF]",
    "adjectives": r"[가-힣]{1,16}[한운른은],?\s+[가-힣]{1,16}[한운른은],?\s+[가-힣]{1,16}[한운른은]",
}
_RULES = {key: re.compile(pattern) for key, pattern in _PATTERNS.items()}
_CONTRACTIONS = {
    "analysis": ("데이터에 대한 분석을 수행했습니다", "데이터를 분석했습니다"),
    "importance": ("중요한 의미를 가집니다", "중요합니다"),
    "template": ("템플릿을 통해 단축했습니다", "템플릿으로 줄였습니다"),
}
_QUESTIONS = {
    "continue": "이어 본 시도인가요, 계속 진행한 작업인가요?",
    "contrast": "두 행동을 대비한 이유를 더 명확히 설명할 수 있나요?",
    "structure": "실제 구조를 설명하는 문장인가요, 수행한 행동을 설명하는 문장인가요?",
    "judgment": "기준에 따른 판정인가요, 직접 내린 결정인가요?",
    "only": "‘만’으로 제한한 대상이 각각 무엇인가요?",
    "result": "이미 얻은 결과인가요, 앞으로 기대하는 결과인가요?",
    "definition": "앞 문장과 같은 개념인가요, 그 수단으로 한 작업인가요?",
    "effect": "실제로 관찰한 효과인가요, 예상한 효과인가요?",
    "record": "어떤 기록물에 무엇을 남겼나요?",
    "knowledge": "직접 확인한 사실인가요, 자료에서 추론한 내용인가요?",
    "sequence": "이 순서가 작업 절차와 이동 경로 중 무엇을 뜻하나요?",
    "passive": "직접 수행한 작업인가요, 자동으로 일어난 변화인가요?",
    "connector": "이 연결어를 빼도 앞 문장과의 관계가 분명한가요?",
    "dash": "긴 줄표로 나눈 두 부분을 별도 문장으로 읽어도 의미가 같은가요?",
    "emoji": "반복되는 제목 기호가 서로 다른 상태를 구분하나요?",
    "adjectives": "나열한 특성 중 이 경험에서 근거를 보여줄 수 있는 것은 무엇인가요?",
    "contribution": "이 결과를 위해 직접 변경한 부분은 무엇인가요?",
    "experience": "이 표현을 뒷받침하는 경험의 이름은 무엇인가요?",
    "praise": "이 평가를 뒷받침하는 구체적인 사실이나 측정 결과가 있나요?",
}


def style_candidates(document: PageDocument | FlowDocument):
    report = document.extraction
    excluded_lines, excluded_pages = set(), set()
    if report:
        for issue in report.issues:
            if not issue.recovered:
                if issue.lineIds:
                    excluded_lines.update(issue.lineIds)
                elif issue.pageNumber:
                    excluded_pages.add(issue.pageNumber)
                else:
                    return []
    blocks = (block for page in document.pages if page.pageNumber not in excluded_pages
              for block in page.blocks) if isinstance(document, PageDocument) else document.blocks
    candidates = []
    seen = set()
    emoji_count = 0
    for block in blocks:
        for line in block.lines:
            if line.lineId in excluded_lines or getattr(line, "uncertainWords", []):
                continue
            for key, pattern in _RULES.items():
                if key in seen and key != "emoji":
                    continue
                match = pattern.search(line.text)
                if not match or (key == "only" and not pattern.search(line.text, match.end())):
                    continue
                if key == "emoji":
                    emoji_count += 1
                if key not in seen:
                    candidates.append(dict(ruleId=key, lineId=line.lineId, start=match.start(), end=match.end()))
                    seen.add(key)
    return [item for item in candidates if item["ruleId"] != "emoji" or emoji_count > 1]


def verified_style(suggestion: SuggestionDTO, line: str) -> SuggestionDTO | None:
    diag = suggestion.diagnostic
    if not diag:
        return None
    if diag.action == "ask" and diag.ruleId in _QUESTIONS:
        return suggestion.model_copy(update={"example": "[확인 필요: 근거]",
            "reasonAndSuggestion": _QUESTIONS[diag.ruleId]})
    contraction = _CONTRACTIONS.get(diag.ruleId)
    if diag.action == "rewrite" and contraction:
        before, after = contraction
        if line.count(before) == 1 and suggestion.example == line.replace(before, after):
            return suggestion
    return None
