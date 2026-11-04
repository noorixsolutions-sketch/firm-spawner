#!/usr/bin/env python3
"""Free-only eligibility gate. The model researches; this decides.

    python3 scripts/eligibility.py --evidence records.json [--need persistent_serving] [--today YYYY-MM-DD]

Input: a JSON list of evidence records the model collected from official pages:
  {provider, capability, execution, pricing_model, card_required, compute_cost,
   source_url, verified_at, terms_excerpt, limits: [..], restrictions: [..]}
  execution:     persistent_service | interactive_api | batch_worker | ephemeral_notebook
  pricing_model: free_forever | open_source_self_host | free_tier | trial | paid_only | discontinued
  compute_cost:  none | user_owned | paid   (only matters for open_source_self_host)

A status is derived from the record alone. A record with no https source, no date, no
terms excerpt, or older than the TTL becomes `unknown`. The model's own opinion of a
provider is never an input. Statuses: verified_free, free_with_limits,
payment_method_required, trial_only, discontinued, unknown, plus paid_only (extension).
Selectable = verified_free | free_with_limits | payment_method_required (card disclosed),
and suitable for the stated need. Exit 2 on malformed input.
"""
import argparse
import json
import sys
from datetime import date, datetime

SUITABLE = {
    "persistent_service": {"persistent_serving", "interactive", "batch", "experimentation"},
    "interactive_api": {"interactive", "batch", "experimentation"},
    "batch_worker": {"batch", "experimentation"},
    "ephemeral_notebook": {"batch", "experimentation"},
}
PRICING = {"free_forever", "open_source_self_host", "free_tier", "trial", "paid_only", "discontinued"}
SELECTABLE = {"verified_free", "free_with_limits", "payment_method_required"}


def evaluate(rec, today, ttl_days, need):
    reasons = []
    url = str(rec.get("source_url", ""))
    if not url.startswith("https://"):
        reasons.append("no https source_url")
    try:
        verified = datetime.strptime(str(rec.get("verified_at", "")), "%Y-%m-%d").date()
        age = (today - verified).days
        if age < 0:
            reasons.append("verified_at is in the future")
        elif age > ttl_days:
            reasons.append("stale: verified %d days ago (ttl %d)" % (age, ttl_days))
    except ValueError:
        reasons.append("missing or invalid verified_at (YYYY-MM-DD)")
    if not str(rec.get("terms_excerpt", "")).strip():
        reasons.append("no terms_excerpt quoted from the source")
    model = rec.get("pricing_model")
    if model not in PRICING:
        reasons.append("pricing_model must be one of %s" % sorted(PRICING))
    if rec.get("execution") not in SUITABLE:
        reasons.append("execution must be one of %s" % sorted(SUITABLE))

    if reasons:
        status = "unknown"
    elif model == "discontinued":
        status = "discontinued"
    elif model == "trial":
        status = "trial_only"
    elif model == "paid_only":
        status = "paid_only"
    elif model == "open_source_self_host":
        if rec.get("compute_cost") == "paid":
            status = "payment_method_required"
            reasons.append("self-hosting needs paid compute; the software is free, the infrastructure is not")
        elif rec.get("compute_cost") in ("none", "user_owned"):
            status = "verified_free"
        else:
            status = "unknown"
            reasons.append("compute_cost must be none, user_owned or paid")
    elif model == "free_forever":
        status = "payment_method_required" if rec.get("card_required") else "verified_free"
    else:  # free_tier
        status = "payment_method_required" if rec.get("card_required") else "free_with_limits"

    selectable = status in SELECTABLE
    if selectable and need and need not in SUITABLE.get(rec.get("execution"), set()):
        selectable = False
        reasons.append("execution class %s cannot serve %s" % (rec.get("execution"), need))
    if status == "payment_method_required" and "self-hosting" in " ".join(reasons):
        selectable = False

    disclosures = []
    if rec.get("card_required"):
        disclosures.append("PAYMENT CARD REQUIRED to sign up")
    for item in rec.get("limits", []) or []:
        disclosures.append("limit: " + str(item))
    for item in rec.get("restrictions", []) or []:
        disclosures.append("restriction: " + str(item))
    if rec.get("execution") == "ephemeral_notebook":
        disclosures.append("ephemeral session: not a persistent endpoint")
    return {
        "provider": rec.get("provider"), "capability": rec.get("capability"),
        "execution": rec.get("execution"), "status": status, "selectable": selectable,
        "disclosures": disclosures, "reasons": reasons,
        "source_url": url, "verified_at": rec.get("verified_at"),
    }


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--evidence", required=True)
    ap.add_argument("--ttl-days", type=int, default=30)
    ap.add_argument("--today", default=None)
    ap.add_argument("--need", default=None,
                    choices=["persistent_serving", "interactive", "batch", "experimentation"])
    a = ap.parse_args(argv)
    try:
        records = json.load(open(a.evidence))
        if not isinstance(records, list):
            raise ValueError("evidence file must be a JSON list")
        today = datetime.strptime(a.today, "%Y-%m-%d").date() if a.today else date.today()
    except (OSError, ValueError) as e:
        print(json.dumps({"error": str(e)}))
        return 2
    results = [evaluate(r, today, a.ttl_days, a.need) for r in records]
    print(json.dumps({"results": results, "selectable": [r["provider"] for r in results if r["selectable"]]}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
