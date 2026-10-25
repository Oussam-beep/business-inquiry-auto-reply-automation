# Airtable `Leads` table schema

Create one Airtable table named **Leads** and add the following fields exactly as written. Field names are case-sensitive because the workflow maps them directly.

| Field | Suggested Airtable type | Purpose |
|---|---|---|
| `name` | Single line text | Customer name |
| `email` | Email or single line text | Normalized lower-case customer email; used for duplicate lookup |
| `phone` | Single line text | Optional phone |
| `message` | Long text | Original inquiry |
| `timestamp` | Date (include time) | Submission timestamp; duplicate search checks last 24 hours |
| `score` | Number (integer, 1 decimal optional) | AI score on 1–10 scale |
| `category` | Single select or single line text | `hot`, `warm`, or `cold` |
| `summary` | Long text | AI summary or review note |
| `intent` | Single select or single line text | `sales`, `pricing`, `support`, `general`, `spam`, `unknown`, or `unclassified` |
| `status` | Single select or single line text | Values include `replied`, `manual_review`, `manual_review_support`, `manual_review_ai_error`, `manual_review_reply_error`, `email_delivery_failed`, `rejected_invalid_input`, `suppressed_spam`, and `suppressed_duplicate` |
| `reply_subject` | Single line text | Generated subject when available |

Use the same base and table in **Dupe Check (Airtable)**, **Log Lead — replied**, **Log Lead — manual review**, and **Log Duplicate — suppressed**. The `status` field must preserve the exact lowercase value `replied` for duplicate suppression to work.
