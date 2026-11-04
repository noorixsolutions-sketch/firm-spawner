#!/usr/bin/env python3
"""Scan a directory for secret material before anything is published or pasted.

    python3 scripts/scan_secrets.py <dir> [<dir> ...]

Exit 1 if anything matches. Output never contains the matched value, only file, line and
the pattern name. Run it on the rendered firm, on notebooks before pasting, and on any
log or diagnostic text before showing it to a model.
"""
import os
import re
import sys

PATTERNS = {
    "huggingface token": re.compile(r"\bhf_[A-Za-z0-9]{30,}\b"),
    "github token": re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b"),
    "github fine-grained token": re.compile(r"\bgithub_pat_[A-Za-z0-9_]{40,}\b"),
    "groq key": re.compile(r"\bgsk_[A-Za-z0-9]{30,}\b"),
    "openai-style key": re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    "aws access key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "google api key": re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"),
    "slack token": re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"),
    "private key block": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "inline credential": re.compile(
        r"""(?ix)\b(api[_-]?key|token|secret|password)\b\s*[:=]\s*["'][^"'${}\s]{16,}["']"""),
}
SKIP_DIRS = {".git", "node_modules", "__pycache__"}


def scan(paths):
    findings = []
    for base in paths:
        for root, dirs, files in os.walk(base):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for name in files:
                p = os.path.join(root, name)
                try:
                    with open(p, encoding="utf-8") as f:
                        for ln, line in enumerate(f, 1):
                            for label, rx in PATTERNS.items():
                                if rx.search(line):
                                    findings.append((p, ln, label))
                except (UnicodeDecodeError, OSError):
                    continue
    return findings


def main(argv=None):
    paths = (argv if argv is not None else sys.argv[1:]) or ["."]
    findings = scan(paths)
    for p, ln, label in findings:
        print("%s:%d: %s" % (p, ln, label))
    print("secret scan: %d finding(s)" % len(findings))
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
