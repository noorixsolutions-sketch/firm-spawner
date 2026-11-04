# Provider discovery and free-only eligibility

Stage 3 and 4. You research and explain; `scripts/eligibility.py` decides what is selectable; the operator chooses.

## The policy (hard-coded, not a recommendation)

Selectable options are only:

- permanently free to use;
- open-source and usable without a mandatory recurring provider charge;
- a genuine free tier.

Never selectable: paid-only products, trial-only offers (credits that run out do not make a free tier),
discontinued services, anything unverified. A required payment card is disclosed prominently, in the first
line of that option. Quotas, expiry conditions and usage limits are listed. Free software is not free
infrastructure: self-hosting an open model on paid compute is not zero-cost, and the script marks it so.

The provider list is researched live every time, never copied from memory or from an earlier firm.

## Procedure per capability

1. **Requirements.** From the business, write what the capability must do: workload type (interactive, batch, persistent), volume, latency tolerance, data sensitivity, API compatibility needed.
2. **Discover.** Search current options broadly (hosted APIs, free tiers, self-hostable open source, notebook platforms). Use official pricing, terms and docs pages, not blogs. Search each candidate separately.
3. **Evidence record per candidate.** One JSON object, from the official source:

```json
{
  "provider": "Example Cloud",
  "capability": "inference",
  "execution": "interactive_api",
  "pricing_model": "free_tier",
  "card_required": false,
  "compute_cost": "none",
  "source_url": "https://example.com/pricing",
  "verified_at": "2026-11-04",
  "terms_excerpt": "Short quote or close paraphrase of the free-plan terms",
  "limits": ["N requests per day", "model list restricted"],
  "restrictions": ["no commercial use on free plan"]
}
```

   `execution` is one of `persistent_service`, `interactive_api`, `batch_worker`, `ephemeral_notebook`.
   `pricing_model` is one of `free_forever`, `open_source_self_host`, `free_tier`, `trial`, `paid_only`, `discontinued`.
   Quote briefly; never paste long passages from a source.
4. **Gate.** Save the records to a file and run:

```bash
python3 scripts/eligibility.py --evidence records.json --need batch
```

   `--need` is the workload class: `persistent_serving`, `interactive`, `batch`, `experimentation`. Statuses: `verified_free`,
   `free_with_limits`, `payment_method_required` (a free tier that needs a card; selectable with disclosure),
   `trial_only`, `discontinued`, `unknown`, and `paid_only`. Records older than 30 days, with no https source, no date or no
   quoted terms become `unknown`. Only `selectable` results may be offered.
5. **Compare** the selectable options on what each actually is. Do not call technically different services
   interchangeable: a hosted inference API, a Kaggle notebook, a Colab session and a self-hosted GPU job have different
   execution models, quotas and lifetimes. Say which workloads each can and cannot serve, and why.
6. **Present**, recommend with a reason tied to this firm's requirements (never a generic ranking), and let the
   operator choose.

## Comparison format

For each selectable option give, briefly: what it does; the free allowance; limits and restrictions (commercial use,
data retention, residency if known); hardware; API compatibility with the firm's contract (for inference, OpenAI-compatible
or not); what the firm needs to do to wire it; what happens when the free quota ends; last verification date and source.
Mark anything you could not verify as unverified rather than leaving it out.

## Execution classes and what they can serve

| Class | Examples | Fine for | Not for |
|---|---|---|---|
| `persistent_service` | free Docker Space, an always-on local machine | control plane, UI, steady endpoints | heavy GPU work on free CPU |
| `interactive_api` | hosted inference free tiers | on-demand calls within quota | guaranteed throughput |
| `batch_worker` | HF Job (if free-eligible), scheduled runs | queued, non-urgent work | low-latency serving |
| `ephemeral_notebook` | Kaggle, Colab | experiments, batch drains, GPU bursts | permanent endpoints, always-on serving; free-tier terms may restrict serving |

## Operator decision

Offer: see all eligible options; inspect one in detail; compare side by side; pick one or several (different capabilities
may use different providers); reject all; ask for more research; confirm. Use the host's selection UI when there is one.
Only offer controls that do something. Append the confirmed choice to `decisions.jsonl`:

```json
{"capability":"inference","choice":"Example Cloud","evidence":"https://example.com/pricing","verified_at":"2026-11-04","decided":"2026-11-04"}
```

The operator is the final decision-maker. A provider that fails the gate stays off the list even if you think it is better.
