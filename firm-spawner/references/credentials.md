# Guided credential provisioning

Stage 5. The operator creates and enters every secret, because only they can pass sign-up checks and
accept terms. Your job is to make that take minutes: exact page, exact scopes, exact place to store it,
and a check that never reveals the value.

## Principles

- **One identity, many credentials.** The firm's Gmail account is the identity anchor: sign up with it, or use "Continue with Google" where the provider offers it. Each provider still issues its own token; Gmail cannot mint them. Never imply otherwise.
- **Never automate sign-up or terms acceptance.** CAPTCHAs, email verification, payment-card prompts and terms are the operator's. Do not script around them.
- **Never ask for a value in chat.** If the operator pastes one anyway, do not repeat or store it; tell them to revoke and recreate it, then continue with the secret store.
- **Least privilege, one token per purpose and per firm.** A worker that only reads needs a read token. Name the token after the firm and purpose (for example `demo-inference-co-worker`) so it can be revoked alone.
- **Names, not values, in the repo.** `secrets.required` lists names. The same name is used on every platform.

## Distinguish credential types before asking

API key (static, provider-issued) · OAuth access token (short-lived) · OAuth refresh token (long-lived, more sensitive) ·
service-account credential · organization-level credential · deployment secret (a token the firm uses at runtime).
State which one you need and why. Prefer fine-grained, scoped tokens over account-wide ones.

## Per-provider card (fill this in for each chosen provider)

Check each link is still the right page before sending the operator there (open it or search the provider's docs);
account pages move.

| Provider | Create it at | Type and minimum scope | Non-secret check (run with the secret in an env var; prints status only) |
|---|---|---|---|
| Hugging Face | https://huggingface.co/settings/tokens | Fine-grained token; read for model download; write only on the firm's own buckets/repos if the firm must write | `hf auth whoami` |
| GitHub | https://github.com/settings/personal-access-tokens/new | Fine-grained PAT limited to the single `firm-<id>` repo; Contents read (clone) or read/write (publish) | `curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/user` expects 200 |
| Kaggle | https://www.kaggle.com/settings (API section) | API token for pushing notebooks and datasets; follow the current on-page instructions | `kaggle kernels list --mine` succeeds |
| Groq | https://console.groq.com/keys | API key | `curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $GROQ_API_KEY" https://api.groq.com/openai/v1/models` expects 200 |
| Cerebras | https://cloud.cerebras.ai/ (API keys) | API key | `curl` the provider's `/v1/models` with the bearer header; expects 200 |
| OpenRouter | https://openrouter.ai/keys | API key | `curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $OPENROUTER_API_KEY" https://openrouter.ai/api/v1/auth/key` expects 200 |
| Supabase | https://supabase.com/dashboard/account/tokens | Personal access token (management API) or the project's own keys; use the least powerful key that works | `curl` the management API project list; 200 |
| Vercel | https://vercel.com/account/tokens | Token scoped to the firm's team/project | `curl` the user endpoint with the bearer header; 200 |
| Colab | no token | Secrets panel only (see below) | the bootstrap cell raises if a secret is missing |

Providers found through research that are not listed here get the same card from their official docs: the
page where the key is created, the type, the minimum scope, a harmless authenticated request that returns a status code.
If a check expects a status code you have not verified for that provider, say so and have the operator confirm in the
provider's docs.

## The walkthrough (what you tell the operator, per provider)

1. **Why**: one line on what this credential lets the firm do.
2. **Go to**: the direct link.
3. **Sign in** with the firm's Gmail. If the provider asks for a card, say that clearly before they proceed and let them stop.
4. **Create**: the exact buttons, the token name, the minimum scopes (list them), expiry if offered.
5. **Copy it once** into the operator's password manager. It is shown once on most providers.
6. **Enter it where the firm will use it** (table below), under the exact secret name.
7. **Check it**: give the status-only command. The operator tells you the status code or pass/fail, nothing else.
8. **Record**: add the name to `secrets.required`; note the provider and date in `decisions.jsonl`. No value.

## Where each secret is entered

| Target | How |
|---|---|
| Local | `.env` file next to `compose/local.yml`, `chmod 600`, listed in `.gitignore` |
| HF Space | the Space's Settings, then Variables and secrets, as a Secret |
| HF Job | passed as a job secret at launch (`hf jobs run --help` shows the current flag) |
| Colab | left sidebar, key icon (Secrets): add the name and value, turn on Notebook access |
| Kaggle | notebook menu, Add-ons, Secrets: add the name and value, attach to the notebook |
| GitHub Actions | repository Settings, Secrets and variables (only if a workflow needs one) |

## Lifecycle

- **Rotate:** create the new token, replace it in each place, run the check, then revoke the old one at the provider.
- **Revoke:** done at the provider, not in the firm. After revoking, the firm's check must fail; run it to prove it.
- **Disconnect or destroy a firm:** list its secret names, have the operator revoke each, then remove them from platform stores.
- **If a secret leaks** (appears in a log, chat, repo or notebook): treat it as compromised, revoke at the provider first, recreate, then clean the artifact and rerun `scripts/scan_secrets.py`.

## If the host offers a secure secret-entry mechanism, use it

Some hosts provide a masked input or a connector. Use that in place of any manual step it can replace. If none exists, the
platform secret stores above are the secure mechanism: the value goes from the operator's keyboard to the platform and never through you.
