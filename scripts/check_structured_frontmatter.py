#!/usr/bin/env python3
"""Study Blog 구조화 front matter 품질 점검.

점검 항목
1) learning_refs 항목 필수 필드(title/href/description)
2) learning_refs href 중복 및 내부 경로 형식
3) key_takeaways / operator_checklist 빈 목록 감지
4) decision_guide.cases 필수 필드 점검
5) FAQ 중복 질문 및 너무 짧은 답변 감지
"""

from __future__ import annotations

import json
import posixpath
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[1]
CONTENT_DIR = REPO / "content"
POSTS_DIR = REPO / "content" / "posts"
FRONT_MATTER_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)
MIN_FAQ_ANSWER_LEN = 30
RUBY_PARSE_SCRIPT = r'''
require "yaml"
require "json"
require "date"

def normalize(value)
  case value
  when Hash
    value.each_with_object({}) { |(k, v), out| out[k.to_s] = normalize(v) }
  when Array
    value.map { |v| normalize(v) }
  when NilClass, TrueClass, FalseClass, Numeric
    value
  else
    value.to_s
  end
end

raw = STDIN.read
parsed = YAML.safe_load(raw, permitted_classes: [Date, Time, Symbol], aliases: true) || {}
puts JSON.generate(normalize(parsed))
'''


def load_front_matter(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    match = FRONT_MATTER_RE.match(text)
    return match.group(1) if match else ""


def parse_yaml(front_matter: str, path: Path) -> dict[str, Any]:
    result = subprocess.run(
        ["ruby", "-e", RUBY_PARSE_SCRIPT],
        input=front_matter,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"YAML parse failed for {path}: {result.stderr.strip()}")
    return json.loads(result.stdout or "{}")


def iter_posts() -> list[Path]:
    return sorted(p for p in POSTS_DIR.glob("*.md") if p.name != "_index.md")


def normalize_route(path: str) -> str:
    path = path.strip()
    if not path.startswith("/"):
        path = "/" + path

    normalized = posixpath.normpath(path.lstrip("/"))
    path = "/" if normalized in {"", "."} else "/" + normalized

    if path != "/" and "." not in Path(path).name and not path.endswith("/"):
        path += "/"
    return path


def route_from_content_rel(rel: Path) -> str:
    if rel.name in {"_index.md", "index.md"}:
        route = "/" + rel.parent.as_posix().strip("/") + "/"
    else:
        route = "/" + rel.with_suffix("").as_posix().strip("/") + "/"
    return normalize_route(route)


def build_content_routes() -> set[str]:
    routes: set[str] = {"/"}
    for md in CONTENT_DIR.rglob("*.md"):
        rel = md.relative_to(CONTENT_DIR)
        if rel.name.startswith("."):
            continue
        for parent in rel.parents:
            if str(parent) != ".":
                routes.add(normalize_route("/" + parent.as_posix() + "/"))
        routes.add(route_from_content_rel(rel))
    return routes


def main() -> int:
    warnings: list[str] = []
    errors: list[str] = []
    content_routes = build_content_routes()

    for post in iter_posts():
        rel = post.relative_to(REPO)
        fm = load_front_matter(post)
        if not fm:
            errors.append(f"[frontmatter] 파싱 실패 또는 누락: {rel}")
            continue

        try:
            data = parse_yaml(fm, rel)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"[frontmatter] YAML 파싱 실패: {rel} ({exc})")
            continue

        for field in ("key_takeaways", "operator_checklist"):
            if field in data and not data.get(field):
                warnings.append(f"[{field}] 비어 있음: {rel}")

        seen_hrefs: set[str] = set()
        for idx, item in enumerate(data.get("learning_refs") or [], start=1):
            if not isinstance(item, dict):
                errors.append(f"[learning_refs] 객체 아님 #{idx}: {rel}")
                continue
            title = str(item.get("title", "")).strip()
            href = str(item.get("href", "")).strip()
            description = str(item.get("description", "")).strip()
            missing = [name for name, value in (("title", title), ("href", href), ("description", description)) if not value]
            if missing:
                errors.append(f"[learning_refs] 필수 필드 누락 {missing} #{idx}: {rel}")
            if href:
                if not href.startswith("/"):
                    errors.append(f"[learning_refs] 내부 경로 아님 #{idx}: {rel} -> {href}")
                elif normalize_route(href.split("#", 1)[0].split("?", 1)[0]) not in content_routes:
                    errors.append(f"[learning_refs] 콘텐츠 경로 없음 #{idx}: {rel} -> {href}")
                if href in seen_hrefs:
                    warnings.append(f"[learning_refs] 중복 href #{idx}: {rel} -> {href}")
                seen_hrefs.add(href)

        decision_guide = data.get("decision_guide") or {}
        for idx, item in enumerate(decision_guide.get("cases") or [], start=1):
            if not isinstance(item, dict):
                errors.append(f"[decision_guide] case 객체 아님 #{idx}: {rel}")
                continue
            missing = [key for key in ("badge", "title", "fit", "watchouts", "next_step") if not str(item.get(key, "")).strip()]
            if missing:
                warnings.append(f"[decision_guide] case 필드 누락 {missing} #{idx}: {rel}")

        seen_questions: set[str] = set()
        for idx, item in enumerate(data.get("faqs") or [], start=1):
            if not isinstance(item, dict):
                errors.append(f"[faqs] 객체 아님 #{idx}: {rel}")
                continue
            question = str(item.get("question", "")).strip()
            answer = str(item.get("answer", "")).strip()
            if not question or not answer:
                errors.append(f"[faqs] question/answer 누락 #{idx}: {rel}")
                continue
            if question in seen_questions:
                warnings.append(f"[faqs] 중복 질문 #{idx}: {rel} -> {question}")
            seen_questions.add(question)
            if len(answer) < MIN_FAQ_ANSWER_LEN:
                warnings.append(f"[faqs] 답변이 너무 짧음 #{idx}: {rel} -> {question}")

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
