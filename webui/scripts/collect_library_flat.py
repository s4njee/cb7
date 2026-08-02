#!/usr/bin/env python3
"""Collect CB8 ebook and manga files into one flat backup folder.

This reads CB8's SQLite library database, finds PDF/EPUB/CBZ/CBR files, shows
the total space needed, compares it to free space at the destination, and then
copies the files into a single folder with duplicate filenames disambiguated.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path


SUPPORTED_EXTENSIONS = {".pdf", ".epub", ".cbz", ".cbr"}


@dataclass(frozen=True)
class SourceFile:
    file_path: Path
    title: str


@dataclass(frozen=True)
class PreparedFile:
    source: SourceFile
    target_path: Path
    size: int


def default_db_path() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "CB8" / "library.db"
    if os.name == "nt":
        appdata = os.environ.get("APPDATA")
        if appdata:
            return Path(appdata) / "CB8" / "library.db"
    xdg_config = os.environ.get("XDG_CONFIG_HOME")
    base = Path(xdg_config) if xdg_config else Path.home() / ".config"
    return base / "CB8" / "library.db"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Collect CB8 PDF, EPUB, CBZ, and CBR files into a flat backup folder.",
    )
    parser.add_argument(
        "destination",
        type=Path,
        help="Folder where files should be copied.",
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=default_db_path(),
        help="Path to CB8 library.db. Defaults to the normal app data location.",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Copy without prompting after showing the space estimate.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only print what would be copied.",
    )
    return parser.parse_args()


def load_sources(db_path: Path) -> list[SourceFile]:
    if not db_path.exists():
        raise FileNotFoundError(f"Database not found: {db_path}")

    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT file_path, title
            FROM comics
            WHERE lower(file_path) LIKE '%.pdf'
               OR lower(file_path) LIKE '%.epub'
               OR lower(file_path) LIKE '%.cbz'
               OR lower(file_path) LIKE '%.cbr'
            ORDER BY title COLLATE NOCASE
            """
        ).fetchall()

    return [SourceFile(Path(file_path), title) for file_path, title in rows]


def prepare_files(sources: list[SourceFile], destination: Path) -> tuple[list[PreparedFile], list[SourceFile]]:
    prepared: list[PreparedFile] = []
    missing: list[SourceFile] = []
    used_names: set[str] = set()

    for source in sources:
        try:
            stat = source.file_path.stat()
        except OSError:
            missing.append(source)
            continue

        if not source.file_path.is_file():
            missing.append(source)
            continue

        target_path = unique_target_path(destination, source.file_path.name, used_names)
        prepared.append(PreparedFile(source=source, target_path=target_path, size=stat.st_size))

    return prepared, missing


def unique_target_path(destination: Path, filename: str, used_names: set[str]) -> Path:
    parsed = Path(filename)
    stem = parsed.stem
    suffix = parsed.suffix
    candidate = filename
    counter = 2

    while candidate in used_names or (destination / candidate).exists():
        candidate = f"{stem} ({counter}){suffix}"
        counter += 1

    used_names.add(candidate)
    return destination / candidate


def confirm(prepared: list[PreparedFile], missing: list[SourceFile], destination: Path, assume_yes: bool) -> bool:
    total_bytes = sum(item.size for item in prepared)
    free_bytes = shutil.disk_usage(destination).free

    print(f"Files to copy: {len(prepared)}")
    print(f"Space needed: {format_bytes(total_bytes)}")
    print(f"Free space at destination: {format_bytes(free_bytes)}")
    if missing:
        print(f"Missing or unreadable files skipped: {len(missing)}")
    print(f"Destination: {destination}")

    if free_bytes < total_bytes:
        print("Warning: destination may not have enough free space.", file=sys.stderr)

    if assume_yes:
        return True

    answer = input("Copy files into this flat folder? [y/N] ").strip().lower()
    return answer in {"y", "yes"}


def copy_files(prepared: list[PreparedFile], dry_run: bool) -> int:
    failures = 0
    for index, item in enumerate(prepared, start=1):
        print(f"[{index}/{len(prepared)}] {item.source.file_path} -> {item.target_path}")
        if dry_run:
            continue

        try:
            if item.source.file_path.resolve() == item.target_path.resolve():
                continue
            shutil.copy2(item.source.file_path, item.target_path)
        except OSError as exc:
            failures += 1
            print(f"Failed: {exc}", file=sys.stderr)

    return failures


def format_bytes(bytes_count: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    value = float(bytes_count)
    unit_index = 0
    while value >= 1024 and unit_index < len(units) - 1:
        value /= 1024
        unit_index += 1
    digits = 0 if value >= 10 or unit_index == 0 else 1
    return f"{value:.{digits}f} {units[unit_index]}"


def main() -> int:
    args = parse_args()
    destination = args.destination.expanduser().resolve()
    destination.mkdir(parents=True, exist_ok=True)

    sources = load_sources(args.db.expanduser())
    if not sources:
        print("No PDF, EPUB, CBZ, or CBR files found in the CB8 library.")
        return 0

    prepared, missing = prepare_files(sources, destination)
    if not prepared:
        print("No readable source files found.")
        return 1

    if not confirm(prepared, missing, destination, args.yes or args.dry_run):
        print("Cancelled.")
        return 0

    failures = copy_files(prepared, args.dry_run)
    if args.dry_run:
        print("Dry run complete. No files were copied.")
    elif failures:
        print(f"Finished with {failures} failed copies.", file=sys.stderr)
        return 1
    else:
        print("Finished.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
