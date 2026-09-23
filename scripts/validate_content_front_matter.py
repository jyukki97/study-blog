#!/usr/bin/env python3
"""Hugo 원본 콘텐츠의 공개 메타데이터와 중복 설명을 빌드 전에 점검한다.

생성된 HTML 검증만으로는 설명 누락이나 서로 다른 글의 같은 검색 요약을
원인 위치에서 찾기 어렵다. 이 검사는 공개 문서만 대상으로 하며, 목록
페이지(``_index.md``)에는 날짜를 요구하지 않는다.
"""

from __future__ import annotations

import re
import sys
from collections import defaultdict
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
CONTENT_DIR = REPO / "content"
REQUIRED_FIELDS = ("title", "description")
FIELD_PATTERN = re.compile(r"^(title|date|draft|description):\s*(.*?)\s*$", re.MULTILINE)


def front_matter(path: Path) -> dict[str, str] | None:
    """간단한 YAML front matter에서 이 검사에 필요한 scalar 필드만 추린다."""

    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return None
    closing = text.find("\n---", 4)
    if closing == -1:
        return None
    fields: dict[str, str] = {}
    for key, value in FIELD_PATTERN.findall(text[4:closing]):
        fields[key] = value.strip().strip('"\'')
    return fields


def is_draft(fields: dict[str, str]) -> bool:
    return fields.get("draft", "false").casefold() == "true"


def main() -> int:
    errors: list[str] = []
    descriptions: dict[str, list[Path]] = defaultdict(list)
    public_pages = 0

    for path in sorted(CONTENT_DIR.rglob("*.md")):
        fields = front_matter(path)
        relative = path.relative_to(REPO)
        if fields is None:
            errors.append(f"[front-matter] 시작 또는 종료 구분자 없음: {relative}")
            continue
        if is_draft(fields):
            continue

        public_pages += 1
        required = REQUIRED_FIELDS + (() if path.name == "_index.md" else ("date",))
        for key in required:
            if not fields.get(key, "").strip():
                errors.append(f"[front-matter] 공개 문서 필수 {key} 누락: {relative}")

        description = " ".join(fields.get("description", "").split()).casefold()
        if description:
            descriptions[description].append(relative)

    for description, paths in descriptions.items():
        if len(paths) > 1:
            rendered_paths = ", ".join(str(path) for path in paths)
            errors.append(
                f"[description] 공개 문서 설명 중복 ({rendered_paths}): {description[:100]!r}"
            )

    if errors:
        print("콘텐츠 front matter 검증 실패:", file=sys.stderr)
        print(*errors, sep="\n", file=sys.stderr)
        return 1

    print(f"콘텐츠 front matter 검증 통과: 공개 문서 {public_pages}개, 설명 중복 없음")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
