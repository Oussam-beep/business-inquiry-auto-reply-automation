# Business Inquiry Auto-Reply Automation

A focused customization of the upstream n8n AI Lead Follow-Up Agent. The workflow keeps the existing form/email intake, Claude qualification and reply generation, Gmail delivery, and Airtable CRM logging while adding a JSON webhook, input validation, intent-based routing, stricter parsing, and explicit failure-review paths.

**Status:** Source files and local tests are prepared. A live n8n import and calls to Anthropic, Gmail, and Airtable must still be tested in an operator-owned environment. No credentials or secrets are included in this repository.

## What is included

- `business-inquiry-auto-reply.json` — workflow to import into n8n.
- `original-workflow/AI-Lead-Follow-Up-Agent.original.json` — untouched upstream workflow backup.
- `docs/airtable-schema.md` — field names and values expected by the workflow.
- `tests/` — mocked regression tests and example inquiries.
- `scripts/validate_workflow.py` — structural validation checks.
- `test-report.md` — executed local checks and unverified live tests.

## Workflow overview

Form trigger, optional Gmail trigger, and POST webhook converge on the same lead normalization and validation path. Valid inquiries are checked against Airtable for a matching email marked as replied during the previous 24 hours. New inquiries are qualified by Claude, parsed against a strict schema, and routed by intent. Qualified sales, pricing, and general inquiries continue through reply drafting and a validation gate before Gmail delivery. Support and uncertain inquiries go to manual review; spam is logged and suppressed. Qualification, reply-drafting, and delivery errors route to review logging.

## Webhook request

After import, configuration, and activation, use the Production URL displayed by the Webhook node. The path is /webhook/business-inquiry and the method is POST. Send JSON with these fields:

~~~json
{
  "name": "Test Customer",
  "email": "customer@example.com",
  "phone": "555-0100",
  "message": "I would like pricing information for your services."
}
~~~

Example request for a local n8n instance:

~~~bash
curl -i -X POST http://localhost:5678/webhook/business-inquiry \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test Customer","email":"customer@example.com","phone":"555-0100","message":"I would like pricing information."}'
~~~

The webhook returns HTTP 202 to acknowledge that the request was accepted for asynchronous processing. It does not guarantee that qualification, CRM logging, or email delivery succeeded. Inspect the n8n execution and Airtable record for the outcome.

## Classification and routing

The original numeric lead score scale of 1–10 and qualification threshold of 6 or higher are preserved.

| Intent | Behavior |
|---|---|
| sales | Continue through existing score-based qualification |
| pricing | Continue through score-based qualification; do not invent prices |
| general | Continue through qualification without an automatic score increase |
| support | Log and route to human review; no automatic sales reply |
| spam | Log as suppressed; no customer-facing reply |
| missing, unknown, or malformed result | Fail closed to manual review |

The qualification output requires score, category, intent, summary, and reason. Reply output must contain non-empty subject and body fields. The reply prompt must not invent prices, policies, guarantees, or unsupported service facts. The signature is generic and no fake booking URL is included.

## Duplicate-suppression limits

Before qualification, the workflow searches Airtable for the normalized email with status replied within the preceding 24 hours. A match is logged as suppressed_duplicate and does not proceed to email delivery.

This is not a global rate limiter, and an Airtable lookup followed by email delivery is not atomic. Concurrent submissions can race, and an ambiguous delivery failure may occur after the mail provider has accepted a message. Automatic Gmail retries are intentionally not enabled to reduce duplicate sends. Review execution errors and Airtable status before retrying a failed inquiry.

## Import and configuration

1. In n8n, choose Workflows → Import from File and select business-inquiry-auto-reply.json.
2. Configure Anthropic, Gmail OAuth2, and Airtable credentials in n8n. The workflow export must not contain secret values.
3. Create an Airtable table named Leads using docs/airtable-schema.md.
4. Select the same Airtable base and table in the duplicate-check node and all logging nodes.
5. Review the prompt and signature, then test using controlled inquiries and a controlled recipient.
6. Keep the optional Gmail trigger disabled until you intentionally configure and enable it.
7. Activate the workflow only after reviewing successful and failure-path executions.

## Run local checks

Requires Node.js and Python 3.

~~~bash
npm test
npm run validate
~~~

These tests validate the exported graph, expression and Code-node syntax, the intent paths, duplicate-check expression, and mocked parsing/routing scenarios. They do not perform a live n8n import or call Anthropic, Gmail, or Airtable. See test-report.md.

## Changes from upstream

- Added the POST webhook as an additional intake source.
- Normalized customer data from the existing and new trigger paths.
- Added required-field validation before AI processing.
- Extended qualification output with intent, summary, and reason while keeping the existing score/category fields.
- Added intent routing and a safe path for unknown or malformed outputs.
- Preserved Airtable-backed duplicate suppression and added suppression logging.
- Added a reply-output gate and failure outputs for qualification, reply drafting, and email delivery.
- Removed the fictional business identity and example booking URL from customer-facing reply content.

## Attribution

This project modifies the MIT-licensed workflow from GBAnjos/n8n-lead-agent. The upstream license is retained in LICENSE.
