# Test report

Date: 2026-10-25

## Executed locally

- Workflow JSON parses and includes unique node IDs and names.
- All graph edge references resolve to existing nodes and all non-sticky nodes are reachable from an intake trigger or a wired error output.
- All n8n expression strings compile as JavaScript expressions; all Code node bodies compile.
- Required webhook path/method, intent branches, score threshold, reply gate, duplicate formula, and error-output wiring are checked.
- Local Node tests use mocked inputs to check five accepted intents, malformed and unknown qualification output, numeric score handling, reply JSON validity, routing destinations, and fail-closed error statuses.
- Credential secret patterns and fictional booking URLs are scanned.

## Not executed

- Import into an actual n8n runtime and runtime schema validation.
- Live Anthropic API classification/reply generation.
- Real Airtable duplicate query or create-record operations.
- Gmail delivery or OAuth verification.
- Two real webhook submissions 24 hours apart or concurrently.

These require a configured n8n instance, operator-owned provider credentials, and a configured Airtable base. No real customer email was sent by local tests. Do not interpret the local tests as end-to-end integration testing.
