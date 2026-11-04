#!/usr/bin/env python3
"""Resolve values against template.yaml and render the firm template.

    python3 scripts/render.py --template assets/firm-template --values values.yaml --out rendered/<id>

Deterministic and strict: unknown keys, missing required values, type errors, unsafe
characters, leftover placeholders and allow_paid=true are all hard errors (exit 1).
The model fills values; it never edits rendered files by hand.
"""
import argparse
import json
import os
import re
import shutil
import sys

import yaml

PLACEHOLDER = re.compile(r"(?<!\$)\{\{\s*([A-Za-z0-9_.]+)\s*\}\}")
UNSAFE_CHARS = re.compile(r'["\\\n\r]|\{\{|\}\}')
EXCLUDE_DIRS = {"values", ".git"}
TYPES = {"string": str, "int": int, "bool": bool, "list": list, "map": dict}


def load_yaml(path):
    with open(path) as f:
        return yaml.safe_load(f) or {}


def flatten_schema(schema, prefix=""):
    out = {}
    for key, spec in schema.items():
        path = prefix + key
        if isinstance(spec, dict) and "type" in spec:
            out[path] = spec
        elif isinstance(spec, dict):
            out.update(flatten_schema(spec, path + "."))
    return out


def flatten_values(values, prefix=""):
    out = {}
    for key, val in (values or {}).items():
        path = prefix + key
        spec_is_group = isinstance(val, dict)
        if spec_is_group:
            out.update(flatten_values(val, path + "."))
        else:
            out[path] = val
    return out


def type_ok(value, tname):
    if tname == "int":
        return isinstance(value, int) and not isinstance(value, bool)
    return isinstance(value, TYPES[tname])


def resolve(schema_flat, values_flat):
    errors, resolved = [], {}
    for path in values_flat:
        if path not in schema_flat:
            errors.append("unknown key not in template.yaml: " + path)
    for path, spec in schema_flat.items():
        if path in values_flat:
            val = values_flat[path]
        elif "default" in spec:
            val = spec["default"]
        elif spec.get("required"):
            errors.append("missing required value: " + path)
            continue
        else:
            continue
        if not type_ok(val, spec["type"]):
            errors.append("%s must be %s, got %s" % (path, spec["type"], type(val).__name__))
            continue
        if spec["type"] == "string":
            if UNSAFE_CHARS.search(val):
                errors.append(path + ": contains a quote, backslash, newline or brace; rephrase it")
            pat = spec.get("pattern")
            if pat and not re.match(pat, val):
                errors.append("%s does not match %s" % (path, pat))
        resolved[path] = val
    if resolved.get("policy.allow_paid") is True:
        errors.append("policy.allow_paid=true is rejected: free-only is a hard rule")
    return resolved, errors


def fmt(val):
    if isinstance(val, bool):
        return "true" if val else "false"
    if isinstance(val, (list, dict)):
        return json.dumps(val)
    return str(val)


def render_text(text, resolved, missing):
    def sub(m):
        key = m.group(1)
        if key not in resolved:
            missing.add(key)
            return m.group(0)
        return fmt(resolved[key])
    return PLACEHOLDER.sub(sub, text)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--template", required=True)
    ap.add_argument("--values", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)

    schema_flat = flatten_schema(load_yaml(os.path.join(a.template, "template.yaml")))
    values = load_yaml(a.values)
    resolved, errors = resolve(schema_flat, flatten_values(values))

    if resolved.get("inference.enabled"):
        for k in ("inference.model_repo", "inference.model_file", "inference.llama_cpp_ref"):
            if resolved.get(k) in (None, "", "none"):
                errors.append(k + " is required when inference.enabled is true")
    if errors:
        print(json.dumps({"ok": False, "errors": errors}, indent=2))
        return 1

    if os.path.exists(a.out):
        shutil.rmtree(a.out)
    missing, rendered = set(), 0
    for root, dirs, files in os.walk(a.template):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for name in files:
            src = os.path.join(root, name)
            rel = os.path.relpath(src, a.template)
            dst = os.path.join(a.out, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            try:
                with open(src, encoding="utf-8") as f:
                    text = f.read()
            except UnicodeDecodeError:
                shutil.copy2(src, dst)
                continue
            with open(dst, "w", encoding="utf-8") as f:
                f.write(render_text(text, resolved, missing))
            shutil.copymode(src, dst)
            rendered += 1
    shutil.copy2(a.values, os.path.join(a.out, "values.yaml"))

    leftovers = []
    for root, _, files in os.walk(a.out):
        for name in files:
            p = os.path.join(root, name)
            try:
                text = open(p, encoding="utf-8").read()
            except UnicodeDecodeError:
                continue
            if PLACEHOLDER.search(text):
                leftovers.append(os.path.relpath(p, a.out))
    if missing or leftovers:
        print(json.dumps({"ok": False, "errors": [
            "unresolved placeholders: " + ", ".join(sorted(missing)),
            "files with leftovers: " + ", ".join(sorted(leftovers))]}, indent=2))
        return 1
    print(json.dumps({"ok": True, "out": a.out, "files_rendered": rendered}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
