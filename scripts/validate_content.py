#!/usr/bin/env python3
"""Study Blog 콘텐츠 품질 점검 스크립트.

점검 항목
1) front matter 존재 여부
2) posts 글의 필수 필드(title/date/description/tags)
3) posts 글의 제목 중복
4) 마크다운 내부 링크(/...) 경로 유효성
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CONTENT_DIR = REPO / "content"
STATIC_DIR = REPO / "static"

FRONT_MATTER_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)
LINK_RE = re.compile(r"\[[^\]]+\]\((/[^)\s]+)\)")


def normalize_route(path: str) -> str:
    path = path.strip()
    if not path.startswith("/"):
        path = "/" + path
    # Hugo 콘텐츠 페이지는 trailing slash 기준으로 비교
    if "." not in Path(path).name and not path.endswith("/"):
        path += "/"
    return path


def build_content_routes() -> set[str]:
    routes: set[str] = set(["/"])

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

        if rel.name == "_index.md":
            route = "/" + rel.parent.as_posix().strip("/") + "/"
        elif rel.name == "index.md":
            route = "/" + rel.parent.as_posix().strip("/") + "/"
        else:
            route = "/" + rel.with_suffix("").as_posix().strip("/") + "/"

        route = normalize_route(route)
        routes.add(route)

        # front matter custom url 지원
        if fm:
            custom_url = extract_custom_url(fm)
            if custom_url:
                routes.add(normalize_route(custom_url))

    return routes


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


def main() -> int:
    routes = build_content_routes()
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

        # 내부 링크 점검
        for m in LINK_RE.finditer(text):
            raw_link = m.group(1)
            link_no_frag = raw_link.split("#", 1)[0].split("?", 1)[0]
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
