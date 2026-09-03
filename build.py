"""Build static index for Textbook Reader.

Walks ./content/ for .md / .markdown / .txt files, parses frontmatter, headings,
wikilinks and tags, then writes:

    static/data/index.json  — file tree + metadata, no body
    static/data/search.json — body text per file for in-browser search

It can also assemble a ready-to-publish static site (used by GitHub Pages):

    _site/                  — index.html, app.js, style.css, data/, content/

Run:  python build.py            (rebuild the index)
      python build.py --watch    (rebuild on change)
      python build.py --site     (rebuild + assemble _site/ for deployment)
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shutil
import stat
import sys
import time
from pathlib import Path

# Windows consoles default to cp1252, which cannot print the messages below.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent
CONTENT_DIR = ROOT / "content"
STATIC_DIR = ROOT / "static"
DATA_DIR = STATIC_DIR / "data"
SITE_DIR = ROOT / "_site"

ALLOWED_EXT = {".md", ".markdown", ".txt"}

WIKILINK_RE = re.compile(r"\[\[([^\]\n|]+)(?:\|[^\]\n]+)?\]\]")
TAG_RE = re.compile(r"(?:^|[\s,(])#([A-Za-z][\w\-/]*)")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
FENCE_RE = re.compile(r"^(```|~~~)")
FRONTMATTER_RE = re.compile(r"^---\r?\n(.*?)\r?\n---\r?\n", re.DOTALL)


def parse_frontmatter(text: str) -> tuple[dict, str]:
    m = FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    block = m.group(1)
    rest = text[m.end():]
    fm: dict = {}
    pending_key = None
    for raw in block.splitlines():
        if not raw.strip():
            continue
        if pending_key is not None and raw.lstrip().startswith("- "):
            fm[pending_key].append(raw.split("- ", 1)[1].strip().strip('"\''))
            continue
        pending_key = None
        kv = re.match(r"^([\w\-]+)\s*:\s*(.*)$", raw)
        if not kv:
            continue
        key, val = kv.group(1), kv.group(2).strip()
        if not val:
            fm[key] = []
            pending_key = key
        elif val.startswith("[") and val.endswith("]"):
            inner = val[1:-1]
            fm[key] = [v.strip().strip('"\'') for v in inner.split(",") if v.strip()]
        else:
            fm[key] = val.strip('"\'')
    return fm, rest


def strip_code_blocks(text: str) -> str:
    out = []
    in_fence = False
    for line in text.splitlines():
        if FENCE_RE.match(line.lstrip()):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        out.append(re.sub(r"`[^`\n]+`", "", line))
    return "\n".join(out)


def extract_wikilinks(text: str) -> list[str]:
    return [m.group(1).strip() for m in WIKILINK_RE.finditer(strip_code_blocks(text))]


def extract_tags(text: str, fm: dict) -> list[str]:
    tags: set[str] = set()
    for m in TAG_RE.finditer(strip_code_blocks(text)):
        tags.add(m.group(1).lower())
    fm_tags = fm.get("tags") or fm.get("tag")
    if isinstance(fm_tags, str):
        for t in re.split(r"[,\s]+", fm_tags):
            if t:
                tags.add(t.lstrip("#").lower())
    elif isinstance(fm_tags, list):
        for t in fm_tags:
            if isinstance(t, str) and t:
                tags.add(t.lstrip("#").lower())
    return sorted(tags)


def extract_headings(text: str) -> list[dict]:
    headings = []
    in_fence = False
    for line in text.splitlines():
        if FENCE_RE.match(line.lstrip()):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        m = HEADING_RE.match(line)
        if m:
            headings.append({"level": len(m.group(1)), "text": m.group(2).strip()})
    return headings


def title_for(rel: str, fm: dict, headings: list[dict]) -> str:
    if isinstance(fm.get("title"), str) and fm["title"].strip():
        return fm["title"].strip()
    for h in headings:
        if h["level"] == 1:
            return h["text"]
    stem = rel.rsplit("/", 1)[-1]
    return re.sub(r"\.(md|markdown|txt)$", "", stem, flags=re.IGNORECASE)


def word_count(text: str) -> int:
    return len(re.findall(r"\b[\w'\-]+\b", strip_code_blocks(text)))


def resolve_wikilink(target: str, files: dict) -> str | None:
    t = target.strip().lower().replace("\\", "/")
    t_no_ext = re.sub(r"\.(md|markdown|txt)$", "", t)
    for rel in files:
        if re.sub(r"\.(md|markdown|txt)$", "", rel.lower()) == t_no_ext:
            return rel
    for rel in files:
        base = re.sub(r"\.(md|markdown|txt)$", "", rel.split("/")[-1].lower())
        if base == t_no_ext:
            return rel
    return None


def build_tree(base: Path) -> list[dict]:
    def walk(dirpath: Path) -> list[dict]:
        out = []
        children = sorted(dirpath.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        for child in children:
            if child.name.startswith(".") or child.name == "_assets":
                continue
            rel = child.relative_to(base).as_posix()
            if child.is_dir():
                out.append({
                    "type": "dir",
                    "name": child.name,
                    "path": rel,
                    "children": walk(child),
                })
            elif child.suffix.lower() in ALLOWED_EXT:
                out.append({"type": "file", "name": child.name, "path": rel})
        return out
    return walk(base) if base.exists() else []


def collect_records(base: Path) -> dict:
    files: dict = {}
    for p in sorted(base.rglob("*")):
        if not p.is_file() or p.suffix.lower() not in ALLOWED_EXT:
            continue
        rel = p.relative_to(base).as_posix()
        if any(part.startswith(".") or part == "_assets" for part in rel.split("/")):
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        fm, body = parse_frontmatter(text)
        headings = extract_headings(body)
        files[rel] = {
            "path": rel,
            "name": p.name,
            "title": title_for(rel, fm, headings),
            "frontmatter": fm,
            "tags": extract_tags(body, fm),
            "wikilinks": extract_wikilinks(body),
            "headings": headings,
            "word_count": word_count(body),
            "mtime": p.stat().st_mtime,
            "size": p.stat().st_size,
            # body is dropped from index.json — kept aside for search.json.
            "_body": body,
        }
    # Resolve links + backlinks.
    for rec in files.values():
        rec["resolved_links"] = []
        rec["broken_links"] = []
    for rec in files.values():
        for target in rec["wikilinks"]:
            hit = resolve_wikilink(target, files)
            if hit:
                rec["resolved_links"].append(hit)
            else:
                rec["broken_links"].append(target)
    backlinks: dict[str, list[str]] = {p: [] for p in files}
    for src, rec in files.items():
        for dst in set(rec["resolved_links"]):
            if dst != src:
                backlinks[dst].append(src)
    for path, rec in files.items():
        rec["backlinks"] = sorted(backlinks[path])
    return files


def write_outputs(files: dict, tree: list[dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    bodies = {path: rec.pop("_body") for path, rec in files.items()}
    index_payload = {
        "built": dt.datetime.now(dt.timezone.utc).isoformat(),
        "tree": tree,
        "files": files,
    }
    search_payload = {
        "built": index_payload["built"],
        "bodies": bodies,
    }
    with (DATA_DIR / "index.json").open("w", encoding="utf-8") as f:
        json.dump(index_payload, f, ensure_ascii=False, indent=2, sort_keys=True)
    with (DATA_DIR / "search.json").open("w", encoding="utf-8") as f:
        json.dump(search_payload, f, ensure_ascii=False)


def assemble_site(dest: Path = SITE_DIR) -> None:
    """Copy static/ + content/ into a single publishable folder.

    The result is what a static host serves as its document root, so that
    index.html, data/ and content/ all sit side by side and every URL in the
    app can stay relative.
    """
    if dest.exists():
        # OneDrive/Windows can leave read-only attributes behind; clear them
        # and retry rather than failing the build.
        def _force(func, path, _exc):
            os.chmod(path, stat.S_IWRITE)
            func(path)
        shutil.rmtree(dest, onerror=_force)
    ignore = shutil.ignore_patterns(".*", "__pycache__")
    shutil.copytree(STATIC_DIR, dest, ignore=ignore)
    shutil.copytree(CONTENT_DIR, dest / "content", ignore=ignore)
    # Tell GitHub Pages to serve the files as-is (Jekyll drops _-prefixed dirs).
    (dest / ".nojekyll").write_text("", encoding="utf-8")
    print(f"Samlet nettstedet i {dest.name}/ — pek en statisk webvert hit.")


def build_once() -> int:
    if not CONTENT_DIR.exists():
        print(f"Mangler content/ — opprett {CONTENT_DIR.relative_to(ROOT)}/ med markdown-filer.", file=sys.stderr)
        return 1
    files = collect_records(CONTENT_DIR)
    tree = build_tree(CONTENT_DIR)
    write_outputs(files, tree)
    print(f"Skrev {len(files)} filer → static/data/index.json (+ search.json)")
    return 0


def watch_loop() -> int:
    last_mtime = 0.0
    print("Watcher startet. Trykk Ctrl+C for å avslutte.")
    try:
        while True:
            cur = max(
                (p.stat().st_mtime for p in CONTENT_DIR.rglob("*") if p.is_file()),
                default=0.0,
            )
            if cur > last_mtime:
                last_mtime = cur
                build_once()
            time.sleep(1.0)
    except KeyboardInterrupt:
        print("\nAvsluttet.")
        return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Build textbook index")
    ap.add_argument("--watch", action="store_true", help="Bygg automatisk når innholdet endres")
    ap.add_argument("--site", action="store_true", help="Samle _site/ klar for publisering")
    args = ap.parse_args()
    if args.watch:
        if build_once() != 0:
            return 1
        return watch_loop()
    rc = build_once()
    if rc == 0 and args.site:
        assemble_site()
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
