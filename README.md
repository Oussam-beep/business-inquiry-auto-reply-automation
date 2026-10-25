# Business Inquiry Auto-Reply Automation

A customized n8n workflow derived from the upstream [AI Lead Follow-Up Agent](https://github.com/GBAnjos/n8n-lead-agent). It keeps the original form/email intake paths, Claude HTTP requests, score-based qualification, Gmail delivery, and Airtable CRM while adding webhook intake, intent classification/routing, stricter input and AI-output validation, and explicit error-to-review paths.

> **Operational status:** the workflow JSON and local regression checks are prepared. Live email/CRM/AI execution requires credentials and an Airtable base owned by the operator; those cannot be embedded in a portable public workflow. No external integration has been represented as live-tested here.

## Included files

- `business-inquiry-auto-reply.json` — modified workflow to import into n8n.
- `original-workflow/AI-Lead-Follow-Up-Agent.original.json` — untouched original workflow backup.
- `docs/airtable-schema.md` — exact CRM fields and types required by the mappings.
- `tests/workflow.test.js` and `tests/fixtures/inquiries.json` — local mocked regression tests and sample inquiries.
- `scripts/validate_workflow.py` — structural, expression, connection, and secret-pattern checks.
- `test-report.md` — clear distinction between local checks and unexecuted live integration tests.

## Processing architecture

```text
Form trigger ───────────────┐
Optional Gmail trigger → map ├→ Normalize Lead → Validate required fields
POST webhook ───────────────┘                         │
                                      invalid ───────┴→ Airtable manual/rejection log
                                                    │ valid
                                             Airtable duplicate check (24h)
                                                    │
                                       duplicate → suppressed log / stop
                                                    │ new inquiry
                                             Claude qualification
                                                    │
                                             strict JSON parser
                                                    │
                                                intent switch
                                   ┌─────────┬─────────┬─────────┬────────┐
                                   sales   pricing   general  support   spam
                                     └──────────┬──────────┘    │        │
                                       score ≥ 6?             review   suppress
                                         ┌──────┴──────┐
                                     qualify        manual review
                                         │
                                  Claude reply draft
                                         │
                                    reply JSON gate
                                         │ valid
                                    Gmail send (no retry)
                                         │
                                   Airtable replied log

AI qualification, reply-generation, and email-delivery failures route to manual-review logging.
```

## Webhook API

After importing, configuring credentials/resources, and activating the workflow, copy the **Production URL** from the Webhook node; its path is `/webhook/business-inquiry`. The test URL is available in n8n while listening for a test event. The webhook accepts a JSON `POST` body with these fields:

```json
{
  "name": "Test Customer",
  "email": "customer@example.com",
  "phone": "555-0100",
  "message": "I would like pricing information for your services."
}
```

The webhook returns **HTTP 202 Accepted** immediately and processes asynchronously. That response confirms that n8n accepted the request, **not** that the email was delivered or CRM logging succeeded. Check the n8n execution and Airtable status for the final outcome.

Local example for an n8n instance running at `http://localhost:5678`:

```bash
curl -i -X POST http://localhost:5678/webhook/business-inquiry \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test Customer","email":"customer@example.com","phone":"555-0100","message":"I would like pricing information."}'
```

## Classification and routing

The score scale and qualification threshold are preserved from the original flow: numeric score from 1–10, auto-reply qualification at **6 or higher**. The prompt also requires `category` to be `hot`, `warm`, or `cold`, plus a concise `summary` and `reason`.

| Intent | Action |
|---|---|
| `sales` | Continue through existing score threshold |
| `pricing` | Continue through existing score threshold; reply must not invent a price |
| `general` | Continue through existing score threshold; general messages receive no automatic score boost |
| `support` | Log for manual review; no automated customer email |
| `spam` | Log with `suppressed_spam`; no automated customer email |
| Unknown/missing/malformed AI output | Fail closed to manual review |

The reply prompt is context-constrained: it must not invent pricing, guarantees, business policies, availability, or service facts. The workflow appends the generic `Customer Support Team` signature; there is no fictitious business identity or placeholder booking URL.

## Duplicate suppression

Before calling Claude, the workflow searches the configured Airtable table for the normalized lower-case email with status `replied` and a timestamp within the last 24 hours. Matches are logged as `suppressed_duplicate` and do not continue to email delivery.

This is **not** a global rate limiter, and Airtable search plus email delivery is not an atomic transaction. Concurrent inquiries can race; a failure after Gmail accepts a message but before the Airtable `replied` record is written can also weaken duplicate detection on a subsequent retry. Gmail is intentionally not auto-retried on ambiguous delivery errors to avoid deliberate duplicate sends; these errors are logged for human review when Airtable is available. If Airtable itself is unavailable, its logging node fails visibly in the n8n execution; the workflow cannot log an Airtable outage back into that same unavailable table.

## Import and configure

1. In n8n, choose **Workflows → Import from File** and import `business-inquiry-auto-reply.json`.
2. Add/connect credentials for Anthropic, Gmail OAuth2, and Airtable PAT. Credential references in the export contain no secrets.
3. Create an Airtable table named **Leads** using [`docs/airtable-schema.md`](docs/airtable-schema.md).
4. Select the same Airtable base and table in **Dupe Check (Airtable)** and the three Airtable log nodes. Configure any single-select fields to accept the listed status/category/intent values.
5. Use a controlled test recipient first. Confirm Gmail sender identity and the business's approved tone/content in the reply prompt before enabling automatic replies.
6. Keep **Email Lead (optional)** disabled unless you have selected Gmail credentials and intentionally want it to poll for inbound messages.
7. Activate the workflow and test the production webhook endpoint. Review each n8n execution and its Airtable record before using real customer data.

## Tests

Run the local tests from the project directory:

```bash
npm test
npm run validate
```

These local tests exercise parsers and routing assumptions with mock data and verify the exported graph. They do **not** simulate Anthropic, Gmail, or Airtable service behavior, and they are not a substitute for importing into a live n8n instance. See [`test-report.md`](test-report.md). No live customer emails are sent by the local tests.

## Changes relative to upstream

- Added `POST /business-inquiry` as a second intake source.
- Normalized name/email/phone/message from the existing form, email mapping, and webhook body.
- Added required-field validation before qualification and customer-facing email.
- Extended the existing Claude qualification schema with `intent`, summary, and reason while retaining the score/category fields.
- Routed all five intents and added a fallback for unknown/malformed results.
- Preserved Airtable-backed 24-hour duplicate lookup and added duplicate-suppression logging.
- Added reply JSON gating and error outputs for qualification, reply drafting, and email delivery.
- Removed the original sample business identity and fake booking URL.

## Upstream and license

This is a modification of [GBAnjos/n8n-lead-agent](https://github.com/GBAnjos/n8n-lead-agent). The upstream repository's MIT license is included as `LICENSE`; retain attribution when redistributing the derived workflow.
