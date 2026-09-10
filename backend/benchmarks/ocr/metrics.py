def _normalized(text: str) -> str:
    return "".join(text.casefold().split())


def character_error_rate(reference: str, candidate: str) -> float:
    reference, candidate = _normalized(reference), _normalized(candidate)
    if not reference:
        return 0.0 if not candidate else 1.0
    previous = list(range(len(candidate) + 1))
    for row, expected in enumerate(reference, start=1):
        current = [row]
        for column, actual in enumerate(candidate, start=1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[column] + 1,
                    previous[column - 1] + (expected != actual),
                )
            )
        previous = current
    return previous[-1] / len(reference)


def key_token_recall(candidate: str, tokens: list[str]) -> float:
    if not tokens:
        return 1.0
    candidate = candidate.casefold()
    return sum(token.casefold() in candidate for token in tokens) / len(tokens)


def bbox_iou(first: tuple[float, float, float, float], second: tuple[float, float, float, float]) -> float:
    ax, ay, aw, ah = first
    bx, by, bw, bh = second
    overlap_width = max(0.0, min(ax + aw, bx + bw) - max(ax, bx))
    overlap_height = max(0.0, min(ay + ah, by + bh) - max(ay, by))
    intersection = overlap_width * overlap_height
    union = aw * ah + bw * bh - intersection
    return intersection / union if union else 0.0
