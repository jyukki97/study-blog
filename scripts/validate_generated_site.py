#!/usr/bin/env python3
"""Hugo 빌드 산출물의 내부 경로·앵커, SEO, 새 창 링크 안전성을 점검한다."""

from __future__ import annotations

import argparse
import json
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


REPO = Path(__file__).resolve().parents[1]
DEFAULT_PUBLIC_DIR = REPO / "public"
SITE_HOST = "jyukki.com"
IGNORED_SCHEMES = {"data", "mailto", "tel", "javascript"}


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[str] = []
        self.unsafe_blank_links: list[str] = []
        self.canonicals: list[str] = []
        self.json_ld_blocks: list[str] = []
        self.ids: list[str] = []
        self.images_without_alt: list[str] = []
        self.html_langs: list[str] = []
        self.meta_values: dict[str, list[str]] = {}
        self.titles: list[str] = []
        self._in_title = False
        self._title_parts: list[str] = []
        self._in_json_ld = False
        self._json_ld_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "html":
            self.html_langs.append(values.get("lang") or "")
        if tag == "meta":
            key = (values.get("name") or values.get("property") or "").lower()
            if key:
                self.meta_values.setdefault(key, []).append(values.get("content") or "")
        if tag == "title":
            self._in_title = True
            self._title_parts = []
        if values.get("id"):
            self.ids.append(values["id"] or "")
        if tag == "img" and "alt" not in values:
            self.images_without_alt.append(values.get("src") or "(src 없음)")
        if tag in {"a", "link"} and values.get("href"):
            self.links.append(values["href"] or "")
        if tag == "a" and values.get("target") == "_blank":
            rel_tokens = set((values.get("rel") or "").split())
            if not {"noopener", "noreferrer"}.issubset(rel_tokens):
                self.unsafe_blank_links.append(values.get("href") or "(href 없음)")
        if tag in {"img", "script", "source", "iframe"} and values.get("src"):
            self.links.append(values["src"] or "")
        if tag == "link" and "canonical" in (values.get("rel") or "").split():
            self.canonicals.append(values.get("href") or "")
        if tag == "script" and values.get("type") == "application/ld+json":
            self._in_json_ld = True
            self._json_ld_parts = []

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self._title_parts.append(data)
        if self._in_json_ld:
            self._json_ld_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "title" and self._in_title:
            self.titles.append("".join(self._title_parts).strip())
            self._in_title = False
            self._title_parts = []
        if tag == "script" and self._in_json_ld:
            self.json_ld_blocks.append("".join(self._json_ld_parts).strip())
            self._in_json_ld = False
            self._json_ld_parts = []


def local_target(raw_url: str) -> str | None:
    raw_url = raw_url.strip()
    if not raw_url or raw_url.startswith(("#", "//")):
        return None
    parsed = urlsplit(raw_url)
    if parsed.scheme in IGNORED_SCHEMES:
        return None
    if parsed.scheme in {"http", "https"} and parsed.hostname not in {SITE_HOST, f"www.{SITE_HOST}"}:
        return None
    if parsed.scheme and parsed.scheme not in {"http", "https"}:
        return None
    return unquote(parsed.path or "/")


def target_exists(public_dir: Path, path: str) -> bool:
    return target_file(public_dir, path) is not None


def target_file(public_dir: Path, path: str) -> Path | None:
    """사이트 URL 경로가 가리키는 실제 산출물 파일을 반환한다."""

    relative = path.lstrip("/")
    candidates = [public_dir / relative]
    if path.endswith("/") or not Path(relative).suffix:
        candidates.append(public_dir / relative / "index.html")
    if relative.endswith(".html"):
        candidates.append(public_dir / relative.removesuffix(".html") / "index.html")
    return next((candidate for candidate in candidates if candidate.is_file()), None)


def local_fragment_target(raw_url: str, current_file: Path, public_dir: Path) -> tuple[Path, str] | None:
    """내부 링크의 대상 HTML과 fragment를 반환한다.

    ``#section`` 같은 동일 페이지 링크도 포함한다. 외부 링크와 fragment가
    없는 링크는 검사 대상이 아니다.
    """

    raw_url = raw_url.strip()
    if not raw_url or raw_url.startswith("//"):
        return None

    parsed = urlsplit(raw_url)
    if not parsed.fragment or parsed.scheme in IGNORED_SCHEMES:
        return None
    if parsed.scheme in {"http", "https"} and parsed.hostname not in {SITE_HOST, f"www.{SITE_HOST}"}:
        return None
    if parsed.scheme and parsed.scheme not in {"http", "https"}:
        return None

    fragment = unquote(parsed.fragment)
    if not parsed.path:
        return current_file, fragment

    path = unquote(parsed.path)
    target = target_file(public_dir, path)
    return (target, fragment) if target is not None and target.suffix == ".html" else None


def json_ld_items(blocks: list[str], rel: Path, errors: list[str]) -> list[dict]:
    """JSON-LD 블록을 파싱하고 객체 목록으로 평탄화한다."""

    items: list[dict] = []
    for index, block in enumerate(blocks, start=1):
        try:
            value = json.loads(block)
        except json.JSONDecodeError as exc:
            errors.append(f"[json-ld] 파싱 실패 #{index}: {rel} ({exc.msg})")
            continue
        if isinstance(value, dict):
            items.append(value)
        elif isinstance(value, list):
            items.extend(item for item in value if isinstance(item, dict))
    return items


def validate_article_schema(items: list[dict], rel: Path, canonical: str, errors: list[str]) -> None:
    """article OG 페이지가 검색 결과에 필요한 Article JSON-LD를 갖는지 확인한다."""

    article_types = {"Article", "BlogPosting"}
    articles = [item for item in items if item.get("@type") in article_types]
    if not articles:
        errors.append(f"[json-ld] Article 또는 BlogPosting 없음: {rel}")
        return

    article = articles[0]
    for field in ("headline", "description", "datePublished", "dateModified", "mainEntityOfPage", "author"):
        if not article.get(field):
            errors.append(f"[json-ld] Article 필수 필드 누락 {field}: {rel}")

    entity = article.get("mainEntityOfPage")
    if isinstance(entity, dict) and entity.get("@id") and entity["@id"] != canonical:
        errors.append(f"[json-ld] mainEntityOfPage canonical 불일치: {rel}")


def validate(public_dir: Path) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    html_files = sorted(public_dir.rglob("*.html"))
    if not html_files:
        return [f"[build] HTML 산출물이 없습니다: {public_dir}"], warnings

    canonical_to_pages: dict[str, list[Path]] = {}
    parsed_pages: dict[Path, PageParser] = {}
    for html_file in html_files:
        rel = html_file.relative_to(public_dir)
        parser = PageParser()
        try:
            parser.feed(html_file.read_text(encoding="utf-8"))
        except (OSError, UnicodeError) as exc:
            errors.append(f"[html] 읽기 실패: {rel} ({exc})")
            continue
        parsed_pages[html_file] = parser

        if rel != Path("offline.html"):
            if parser.html_langs != ["ko"]:
                errors.append(f"[seo] html lang은 'ko'여야 합니다: {rel} -> {parser.html_langs!r}")

            if len(parser.titles) != 1 or not parser.titles[0]:
                errors.append(f"[seo] 유효한 title이 1개여야 합니다: {rel} -> {parser.titles!r}")

            required_meta = ("description", "author", "og:title", "og:description", "twitter:title")
            for meta_name in required_meta:
                values = parser.meta_values.get(meta_name, [])
                if len(values) != 1 or not values[0].strip():
                    errors.append(
                        f"[seo] 유효한 {meta_name} 메타가 1개여야 합니다: {rel} -> {values!r}"
                    )

            if len(parser.canonicals) != 1:
                errors.append(f"[canonical] {len(parser.canonicals)}개 발견: {rel}")
            else:
                canonical_to_pages.setdefault(parser.canonicals[0], []).append(rel)

        schema_items = json_ld_items(parser.json_ld_blocks, rel, errors)
        if parser.meta_values.get("og:type") == ["article"] and len(parser.canonicals) == 1:
            validate_article_schema(schema_items, rel, parser.canonicals[0], errors)

        for raw_url in parser.links:
            target = local_target(raw_url)
            if target is not None and not target_exists(public_dir, target):
                errors.append(f"[link] 없는 경로 {raw_url!r}: {rel}")

            fragment_target = local_fragment_target(raw_url, html_file, public_dir)
            if fragment_target is not None:
                target_html, fragment = fragment_target
                target_parser = parsed_pages.get(target_html)
                if target_parser is None:
                    target_parser = PageParser()
                    try:
                        target_parser.feed(target_html.read_text(encoding="utf-8"))
                    except (OSError, UnicodeError) as exc:
                        errors.append(f"[html] 앵커 대상 읽기 실패: {rel} -> {raw_url!r} ({exc})")
                        continue
                    parsed_pages[target_html] = target_parser
                if fragment not in target_parser.ids:
                    errors.append(f"[anchor] 없는 앵커 {raw_url!r}: {rel}")

        for raw_url in parser.unsafe_blank_links:
            errors.append(
                f"[security] 새 창 링크에 rel=\"noopener noreferrer\" 누락: {rel} -> {raw_url}"
            )

        duplicate_ids = sorted({element_id for element_id in parser.ids if parser.ids.count(element_id) > 1})
        for element_id in duplicate_ids:
            errors.append(f"[accessibility] 중복 id {element_id!r}: {rel}")

        for image_src in parser.images_without_alt:
            errors.append(f"[accessibility] 이미지 alt 속성 누락: {rel} -> {image_src}")

    for canonical, pages in canonical_to_pages.items():
        if len(pages) > 1:
            sample = ", ".join(str(page) for page in pages[:3])
            warnings.append(f"[canonical] 중복 {canonical}: {sample}")

    return sorted(set(errors)), sorted(set(warnings))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("public_dir", nargs="?", type=Path, default=DEFAULT_PUBLIC_DIR)
    args = parser.parse_args()
    errors, warnings = validate(args.public_dir.resolve())

    for warning in warnings:
        print(f"WARN  {warning}")
    for error in errors:
        print(f"ERROR {error}")
    print("\n요약")
    print(f"- HTML    : {len(list(args.public_dir.resolve().rglob('*.html')))}")
    print(f"- warnings: {len(warnings)}")
    print(f"- errors  : {len(errors)}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
