#!/usr/bin/env python3
"""Validate a rendered firm. The model is never the authority on compatibility; this is.

    python3 scripts/validate.py --rendered rendered/<id> [--template assets/firm-template]
                                [--catalogue catalogue] [--publish]

Checks: values shape, free-only policy, agents schema, plugin bindings against the plugin
catalogue, images against the image catalogue (unknown/unverified rejected), image/target
compatibility, secrets are names only, fixed template logic unchanged (images and every
notebook cell except CONFIG), and (with --publish) digest-pinned versions.lock.
Exit 1 on any error.
"""
import argparse
import hashlib
import json
import os
import re
import sys

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(HERE)
PLACEHOLDER = re.compile(r"(?<!\$)\{\{\s*([A-Za-z0-9_.]+)\s*\}\}")
SECRET_NAME = re.compile(r"^[A-Z][A-Z0-9_]*$")
DIGEST = re.compile(r"sha256:[0-9a-f]{64}")
CONTROL_TARGETS = {"hf-space", "local"}
WORKER_TARGETS = {"kaggle", "colab", "hf-job", "local"}
AGENT_KEYS = {"id": str, "role": str, "responsibilities": list, "plugins": list,
              "permissions": list, "reports_to": str}


def load(path):
    with open(path) as f:
        return yaml.safe_load(f) or {}


def get(d, dotted, default=None):
    for part in dotted.split("."):
        if not isinstance(d, dict) or part not in d:
            return default
        d = d[part]
    return d


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def tree_files(root, sub):
    base = os.path.join(root, sub)
    out = {}
    for r, _, files in os.walk(base):
        for n in files:
            p = os.path.join(r, n)
            out[os.path.relpath(p, root)] = p
    return out


def check_values(values, errors):
    if get(values, "policy.allow_paid", False) is True:
        errors.append("policy.allow_paid must be false")
    cp = get(values, "deploy.control_target", "hf-space")
    if cp not in CONTROL_TARGETS:
        errors.append("deploy.control_target %r not in %s" % (cp, sorted(CONTROL_TARGETS)))
    for t in get(values, "deploy.worker_targets", []) or []:
        if t not in WORKER_TARGETS:
            errors.append("deploy.worker_targets: unsupported target %r" % t)
    for s in get(values, "secrets.required", []) or []:
        if not isinstance(s, str) or not SECRET_NAME.match(s):
            errors.append("secrets.required must be UPPER_SNAKE names only, got %r" % (s,))


def check_agents(rendered, values, bindings, errors):
    seen = set()
    for fname in get(values, "agents.files", []) or []:
        path = os.path.join(rendered, "constitution", "agents", fname)
        if not os.path.isfile(path):
            errors.append("agent file missing: " + fname)
            continue
        ag = load(path)
        for key, typ in AGENT_KEYS.items():
            if not isinstance(ag.get(key), typ) or not ag.get(key):
                errors.append("%s: '%s' must be a non-empty %s" % (fname, key, typ.__name__))
        if ag.get("id") in seen:
            errors.append("duplicate agent id " + str(ag.get("id")))
        seen.add(ag.get("id"))
        for p in ag.get("plugins", []) or []:
            if p not in bindings:
                errors.append("%s: plugin %s is not bound in plugins.bindings" % (fname, p))
    if not seen:
        errors.append("firm has no agents")


def check_images(values, catalogue_dir, errors):
    cat = {i["id"]: i for i in load(os.path.join(catalogue_dir, "images.yaml")).get("images", [])}
    used = []
    ctrl = get(values, "deploy.control_target", "hf-space")
    workers = get(values, "deploy.worker_targets", []) or []
    wanted = [("firm-harness", [ctrl])]
    if workers:
        wanted.append(("firm-worker", workers))
    if get(values, "inference.enabled", False):
        wanted.append(("firm-inference", [t for t in workers if t != "hf-space"] or ["(none)"]))
    for image_id, targets in wanted:
        entry = cat.get(image_id)
        if entry is None:
            errors.append("image not in catalogue (rejected): " + image_id)
            continue
        if entry.get("status") not in ("authored", "verified"):
            errors.append("image %s is %s: confirm it in the inventory stage before use"
                          % (image_id, entry.get("status")))
        for t in targets:
            if t not in entry.get("deploys_to", []):
                errors.append("image %s cannot deploy to %s (supports %s)"
                              % (image_id, t, entry.get("deploys_to")))
        used.append(entry)
    return used


def check_secret_coverage(values, used, errors):
    declared = set(get(values, "secrets.required", []) or [])
    for img in used:
        for s in img.get("secrets", []) or []:
            if s not in declared:
                errors.append("image %s needs secret %s; add it to secrets.required" % (img["id"], s))


def check_plugins(bindings, catalogue_dir, errors):
    known = {p["id"] for p in load(os.path.join(catalogue_dir, "plugins.yaml")).get("plugins", []) or []}
    for b in bindings:
        if b not in known:
            errors.append("plugin binding not in plugin catalogue (rejected): " + str(b))


def check_fixed_logic(rendered, template, errors):
    for rel, p in tree_files(template, "images").items():
        r = os.path.join(rendered, rel)
        if not os.path.isfile(r) or sha(r) != sha(p):
            errors.append("fixed image file changed or missing: " + rel)
    nb_dir = os.path.join(template, "notebooks")
    for name in sorted(os.listdir(nb_dir)):
        t = json.load(open(os.path.join(nb_dir, name)))
        rp = os.path.join(rendered, "notebooks", name)
        if not os.path.isfile(rp):
            errors.append("notebook missing: " + name)
            continue
        r = json.load(open(rp))
        if len(r["cells"]) != len(t["cells"]):
            errors.append("notebook cell count changed: " + name)
            continue
        for i, (tc, rc) in enumerate(zip(t["cells"], r["cells"])):
            if tc["cell_type"] == "code" and i != 1 and tc["source"] != rc["source"]:
                errors.append("%s: fixed code cell %d was modified (only CONFIG may change)" % (name, i))


def check_publish(rendered, values, errors):
    lock = os.path.join(rendered, "versions.lock")
    if not os.path.isfile(lock):
        errors.append("versions.lock missing (required to publish)")
        return
    data = load(lock)
    for img, entry in (data.get("images") or {}).items():
        if not DIGEST.fullmatch(str((entry or {}).get("digest", ""))):
            errors.append("versions.lock: %s has no sha256 digest" % img)
    if not data.get("images"):
        errors.append("versions.lock lists no images")
    if get(values, "inference.enabled", False) and not (data.get("llama_cpp_ref")):
        errors.append("versions.lock: llama_cpp_ref missing")
    if not re.fullmatch(r"[0-9a-f]{40}", str(get(values, "firm.commit", ""))):
        errors.append("firm.commit must be a full 40-char commit SHA when publishing")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--rendered", required=True)
    ap.add_argument("--template", default=os.path.join(SKILL, "assets", "firm-template"))
    ap.add_argument("--catalogue", default=os.path.join(SKILL, "catalogue"))
    ap.add_argument("--publish", action="store_true")
    a = ap.parse_args(argv)

    errors, warnings = [], []
    vpath = os.path.join(a.rendered, "values.yaml")
    if not os.path.isfile(vpath):
        print(json.dumps({"ok": False, "errors": ["values.yaml missing in rendered dir"]}))
        return 1
    values = load(vpath)

    for r, _, files in os.walk(a.rendered):
        for n in files:
            p = os.path.join(r, n)
            try:
                if PLACEHOLDER.search(open(p, encoding="utf-8").read()):
                    errors.append("unresolved placeholder in " + os.path.relpath(p, a.rendered))
            except UnicodeDecodeError:
                pass

    check_values(values, errors)
    bindings = get(values, "plugins.bindings", []) or []
    check_plugins(bindings, a.catalogue, errors)
    check_agents(a.rendered, values, bindings, errors)
    used = check_images(values, a.catalogue, errors)
    check_secret_coverage(values, used, errors)
    check_fixed_logic(a.rendered, a.template, errors)
    if get(values, "inference.enabled", False) and "kaggle" not in (get(values, "deploy.worker_targets", []) or []) \
            and "colab" not in (get(values, "deploy.worker_targets", []) or []) \
            and "local" not in (get(values, "deploy.worker_targets", []) or []) \
            and "hf-job" not in (get(values, "deploy.worker_targets", []) or []):
        errors.append("inference.enabled but no worker target can run firm-inference")
    if get(values, "inference.enabled", False):
        warnings.append("Colab/Kaggle inference is ephemeral batch compute, not a persistent endpoint")
    if a.publish:
        check_publish(a.rendered, values, errors)

    print(json.dumps({"ok": not errors, "errors": errors, "warnings": warnings}, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
