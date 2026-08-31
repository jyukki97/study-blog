#!/usr/bin/env python3
"""Hugo 글의 검색 미리보기 품질을 가볍게 점검한다.

빌드를 통과해도 description이 없거나 너무 짧으면 검색·공유 화면에서
본문 첫 문장이 잘려 보일 수 있다. 이 검사는 배포를 막는 오류와,
콘텐츠 편집에서 검토할 경고를 분리한다.
"""

from __future__ import annotations

import re
import sys
from collections import defaultdict
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
CONTENT = REPO / "content"
FRONT_MATTER = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)
DESCRIPTION = re.compile(r'(?m)^description:\s*["\']?(.+?)["\']?\s*$')
MIN_DESCRIPTION_CHARS = 70
MAX_DESCRIPTION_CHARS = 160


def descriptions() -> tuple[list[tuple[Path, str]], int]:
    result: list[tuple[Path, str]] = []
    errors = 0
    for path in sorted((CONTENT / "posts").rglob("*.md")):
        if path.name in {"_index.md", "index.md"}:
            continue
        match = FRONT_MATTER.match(path.read_text(encoding="utf-8"))
        if not match:
            errors += 1
            print(f"ERROR [frontmatter] 누락: {path.relative_to(REPO)}")
            continue
        description = DESCRIPTION.search(match.group(1))
        if not description:
            errors += 1
            print(f"ERROR [description] 누락: {path.relative_to(REPO)}")
            continue
        result.append((path, description.group(1).strip()))
    return result, errors


def main() -> int:
    entries, errors = descriptions()
    warnings = 0
    grouped: dict[str, list[Path]] = defaultdict(list)

    for path, description in entries:
        rel = path.relative_to(REPO)
        if len(description) < MIN_DESCRIPTION_CHARS:
            warnings += 1
            print(f"WARN  [description] {MIN_DESCRIPTION_CHARS}자 미만: {rel}")
        if len(description) > MAX_DESCRIPTION_CHARS:
            warnings += 1
            print(f"WARN  [description] {MAX_DESCRIPTION_CHARS}자 초과: {rel}")
        grouped[description.casefold()].append(path)

    for duplicate_paths in grouped.values():
        if len(duplicate_paths) > 1:
            warnings += 1
            joined = ", ".join(str(path.relative_to(REPO)) for path in duplicate_paths)
            print(f"WARN  [description] 중복 가능성: {joined}")

    print("\nSEO 메타데이터 요약")
    print(f"- warnings: {warnings}")
    print(f"- errors  : {errors}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
