#!/usr/bin/env python3
"""Hugo 빌드 산출물의 내부 경로, SEO, 새 창 링크 안전성을 점검한다."""

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
        self._in_json_ld = False
        self._json_ld_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
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
        if self._in_json_ld:
            self._json_ld_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
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
    relative = path.lstrip("/")
    candidates = [public_dir / relative]
    if path.endswith("/") or not Path(relative).suffix:
        candidates.append(public_dir / relative / "index.html")
    if relative.endswith(".html"):
        candidates.append(public_dir / relative.removesuffix(".html") / "index.html")
    return any(candidate.is_file() for candidate in candidates)


def validate(public_dir: Path) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    html_files = sorted(public_dir.rglob("*.html"))
    if not html_files:
        return [f"[build] HTML 산출물이 없습니다: {public_dir}"], warnings

    canonical_to_pages: dict[str, list[Path]] = {}
    for html_file in html_files:
        rel = html_file.relative_to(public_dir)
        parser = PageParser()
        try:
            parser.feed(html_file.read_text(encoding="utf-8"))
        except (OSError, UnicodeError) as exc:
            errors.append(f"[html] 읽기 실패: {rel} ({exc})")
            continue

        if rel != Path("offline.html"):
            if len(parser.canonicals) != 1:
                errors.append(f"[canonical] {len(parser.canonicals)}개 발견: {rel}")
            else:
                canonical_to_pages.setdefault(parser.canonicals[0], []).append(rel)

        for index, block in enumerate(parser.json_ld_blocks, start=1):
            try:
                json.loads(block)
            except json.JSONDecodeError as exc:
                errors.append(f"[json-ld] 파싱 실패 #{index}: {rel} ({exc.msg})")

        for raw_url in parser.links:
            target = local_target(raw_url)
            if target is not None and not target_exists(public_dir, target):
                errors.append(f"[link] 없는 경로 {raw_url!r}: {rel}")

        for raw_url in parser.unsafe_blank_links:
            errors.append(
                f"[security] 새 창 링크에 rel=\"noopener noreferrer\" 누락: {rel} -> {raw_url}"
            )

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
