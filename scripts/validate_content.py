#!/usr/bin/env python3
"""Study Blog 콘텐츠 품질 점검 스크립트.

점검 항목
1) front matter 존재 여부
2) posts 글의 필수 필드(title/date/description/tags)
3) posts 글의 제목 중복
4) 마크다운 내부 링크(/... + 상대경로) 유효성
5) posts 글 최소 본문 길이(실질 내용) 확인
6) 라우트 충돌(동일 URL 경로를 여러 문서가 점유) 확인
"""

from __future__ import annotations

import posixpath
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CONTENT_DIR = REPO / "content"
STATIC_DIR = REPO / "static"

FRONT_MATTER_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)
LINK_RE = re.compile(r"(?<!\!)\[[^\]]+\]\(([^)\s]+)\)")
LEGACY_BASEURL_RE = re.compile(r"\{\{\s*site\.baseurl\s*\}\}", re.IGNORECASE)

MIN_POST_BODY_CHARS = 1500


def normalize_route(path: str) -> str:
    path = path.strip()
    if not path.startswith("/"):
        path = "/" + path

    # /a/../b 같은 경로 정규화
    normalized = posixpath.normpath(path.lstrip("/"))
    if normalized in {"", "."}:
        path = "/"
    else:
        path = "/" + normalized

    # Hugo 콘텐츠 페이지는 trailing slash 기준으로 비교
    if path != "/" and "." not in Path(path).name and not path.endswith("/"):
        path += "/"
    return path


def route_from_content_rel(rel: Path) -> str:
    if rel.name == "_index.md":
        route = "/" + rel.parent.as_posix().strip("/") + "/"
    elif rel.name == "index.md":
        route = "/" + rel.parent.as_posix().strip("/") + "/"
    else:
        route = "/" + rel.with_suffix("").as_posix().strip("/") + "/"

    return normalize_route(route)


def build_content_routes() -> tuple[set[str], dict[str, set[Path]]]:
    routes: set[str] = set(["/"])
    route_to_files: dict[str, set[Path]] = {}

    for md in CONTENT_DIR.rglob("*.md"):
        rel = md.relative_to(CONTENT_DIR)
        if rel.name.startswith("."):
            continue

        text = md.read_text(encoding="utf-8")
        fm = parse_front_matter(text)

        # Hugo section/list page는 _index.md가 없어도 디렉터리 단위로 생성될 수 있어 선반영
        parents = list(rel.parents)
        for parent in parents:
            if str(parent) == ".":
                continue
            routes.add(normalize_route("/" + parent.as_posix() + "/"))

        route = route_from_content_rel(rel)
        routes.add(route)
        route_to_files.setdefault(route, set()).add(md)

        # front matter custom url 지원
        if fm:
            custom_url = extract_custom_url(fm)
            if custom_url:
                normalized_custom = normalize_route(custom_url)
                routes.add(normalized_custom)
                route_to_files.setdefault(normalized_custom, set()).add(md)

    return routes, route_to_files


def build_static_routes() -> set[str]:
    routes: set[str] = set()
    if not STATIC_DIR.exists():
        return routes

    for f in STATIC_DIR.rglob("*"):
        if f.is_file():
            routes.add("/" + f.relative_to(STATIC_DIR).as_posix())
    return routes


def parse_front_matter(text: str) -> str | None:
    m = FRONT_MATTER_RE.match(text)
    if not m:
        return None
    return m.group(1)


def extract_custom_url(front_matter: str) -> str | None:
    m = re.search(r'(?m)^\s*url\s*:\s*"?([^"\n]+)"?\s*$', front_matter)
    if not m:
        return None
    return m.group(1).strip()


def required_fields_missing(front_matter: str, fields: list[str]) -> list[str]:
    missing = []
    for field in fields:
        if not re.search(rf"(?m)^\s*{re.escape(field)}\s*:\s*", front_matter):
            missing.append(field)
    return missing


def extract_markdown_body(text: str) -> str:
    m = FRONT_MATTER_RE.match(text)
    if not m:
        return text
    return text[m.end() :]


def substantive_char_count(markdown_body: str) -> int:
    """대략적인 '실질 본문 길이' 측정.

    - 코드블록/인라인코드를 제외해 텍스트 밀도를 본다.
    - 공백 제거 후 문자 수를 계산한다.
    """

    body = re.sub(r"```[\s\S]*?```", " ", markdown_body)
    body = re.sub(r"`[^`]*`", " ", body)
    body = re.sub(r"!\[[^\]]*\]\([^\)]*\)", " ", body)
    body = re.sub(r"\[[^\]]*\]\([^\)]*\)", " ", body)
    return len(re.sub(r"\s+", "", body))


def main() -> int:
    routes, route_to_files = build_content_routes()
    static_routes = build_static_routes()
    errors: list[str] = []
    warnings: list[str] = []

    title_to_files: dict[str, list[Path]] = {}

    for md in CONTENT_DIR.rglob("*.md"):
        text = md.read_text(encoding="utf-8")
        front_matter = parse_front_matter(text)
        rel = md.relative_to(REPO)

        if front_matter is None:
            errors.append(f"[frontmatter] 없음: {rel}")
            continue

        # posts 필수 필드 점검
        if md.is_relative_to(CONTENT_DIR / "posts"):
            missing = required_fields_missing(front_matter, ["title", "date", "description", "tags"])
            if missing:
                errors.append(f"[frontmatter] 필수 필드 누락 {missing}: {rel}")

            tm = re.search(r'(?m)^\s*title\s*:\s*"?(.+?)"?\s*$', front_matter)
            if tm:
                title = tm.group(1).strip()
                title_to_files.setdefault(title, []).append(md)

            # 품질 규칙: 본문 실질 내용 최소 길이
            if md.name not in {"_index.md", "index.md"}:
                body_chars = substantive_char_count(extract_markdown_body(text))
                if body_chars < MIN_POST_BODY_CHARS:
                    warnings.append(
                        f"[content] 본문 길이 점검 필요({body_chars}자 < {MIN_POST_BODY_CHARS}자): {rel}"
                    )

        if LEGACY_BASEURL_RE.search(text):
            warnings.append(f"[content] '{{{{site.baseurl}}}}' 사용 감지(절대 경로 또는 absURL 권장): {rel}")

        # 내부 링크 점검
        for m in LINK_RE.finditer(text):
            raw_link = m.group(1).strip()
            link_no_frag = raw_link.split("#", 1)[0].split("?", 1)[0].strip()

            if not link_no_frag:
                continue

            # 외부/특수 스킴은 점검 대상 제외
            if link_no_frag.startswith("#") or re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", link_no_frag):
                continue

            # 절대 경로(/...) 내부 링크
            if link_no_frag.startswith("/"):
                normalized = normalize_route(link_no_frag)

                if link_no_frag.endswith(".md"):
                    warnings.append(f"[link] .md 직접 링크 사용(권장X): {rel} -> {raw_link}")

                # 정적 리소스 링크(확장자 포함)는 static 기준
                has_ext = "." in Path(link_no_frag).name
                if has_ext:
                    if link_no_frag not in static_routes:
                        errors.append(f"[link] 정적 파일 경로 없음: {rel} -> {raw_link}")
                    continue

                if normalized not in routes:
                    errors.append(f"[link] 콘텐츠 경로 없음: {rel} -> {raw_link}")
                continue

            # 상대 경로 링크 점검
            current_rel_dir = md.relative_to(CONTENT_DIR).parent
            resolved_rel = Path(posixpath.normpath((current_rel_dir / link_no_frag).as_posix()))

            if str(resolved_rel).startswith(".."):
                errors.append(f"[link] 콘텐츠 루트 바깥 상대경로: {rel} -> {raw_link}")
                continue

            has_ext = "." in Path(link_no_frag).name

            # 상대 .md 링크 점검
            if has_ext and resolved_rel.suffix.lower() == ".md":
                target_md = CONTENT_DIR / resolved_rel
                if not target_md.exists():
                    errors.append(f"[link] 상대 .md 대상 없음: {rel} -> {raw_link}")
                    continue

                warnings.append(f"[link] .md 직접 링크 사용(권장X): {rel} -> {raw_link}")
                normalized = route_from_content_rel(target_md.relative_to(CONTENT_DIR))
                if normalized not in routes:
                    errors.append(f"[link] 콘텐츠 경로 없음: {rel} -> {raw_link}")
                continue

            # 상대경로 + 확장자 없음: 콘텐츠 라우트로 간주
            if not has_ext:
                normalized = normalize_route("/" + resolved_rel.as_posix())
                if normalized not in routes:
                    errors.append(f"[link] 콘텐츠 경로 없음: {rel} -> {raw_link}")
                continue

            # 상대경로 정적 리소스 링크는 실제 파일 존재 여부만 점검
            target_file = (md.parent / link_no_frag).resolve()
            if not target_file.exists():
                warnings.append(f"[link] 상대 정적 리소스 대상 없음(확인 권장): {rel} -> {raw_link}")

    # 라우트 충돌 검사
    for route, files in route_to_files.items():
        if len(files) <= 1:
            continue
        rel_files = ", ".join(sorted(str(f.relative_to(REPO)) for f in files))
        errors.append(f"[route] 동일 경로 충돌: {route} ({rel_files})")

    # 제목 중복
    for title, files in title_to_files.items():
        if len(files) > 1:
            file_list = ", ".join(str(f.relative_to(REPO)) for f in files)
            warnings.append(f"[title] 중복 제목: '{title}' ({file_list})")

    for w in warnings:
        print("WARN ", w)
    for e in errors:
        print("ERROR", e)

    print("\n요약")
    print(f"- warnings: {len(warnings)}")
    print(f"- errors  : {len(errors)}")

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
