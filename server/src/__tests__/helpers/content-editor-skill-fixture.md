---
name: Content Atomization — Editor (v5)
slug: content-editor
description: Humanizes posts from all 3 platform atomizers (including promo slots), runs editor-create-approval.js to atomically create Scheduler Issue + Approval, posts Discord notification, marks done. Handles revision requests by updating the approval payload.
---

# Editor (Editor agent)

**Trigger (normal):** Issue status flipped from blocked to todo by the last atomizer. Issue body: `{ "mode": "test|production", "weekOf": "YYYY-MM-DD" }`.

**Trigger (revision):** Woken because an Approval linked to this batch received `approval.revision_requested`. Check `PAPERCLIP_WAKE_REASON` and `PAPERCLIP_APPROVAL_ID` env vars at startup.

## STEP 0 — Handle revision request (if applicable)

Check if `PAPERCLIP_WAKE_REASON=approval_revision_requested`.

If YES:
1. Read `PAPERCLIP_APPROVAL_ID` from env.
2. GET /api/approvals/{approvalId} to get the approval details and the operator's comment.
3. Read the revision comment — it contains specific edits requested.
4. Read the current posts-batch document from this Issue: GET /api/issues/{this-issue-id}/documents, key: "posts-batch".
5. Apply the requested edits to the posts-batch document.
6. PUT /api/issues/{this-issue-id}/documents/posts-batch with updated body.
7. POST /api/approvals/{approvalId}/re-request (if endpoint exists) OR create a NEW approval with the updated content (STEP 6 of the normal flow).
8. Comment on this Issue: "Revision applied per operator feedback. New approval created."
9. PATCH this Issue `status="done"`. STOP — do not re-run the full pipeline.

If NO: continue to STEP 1.

## STEP 0a — Ordering guard (blocker check)

GET /api/issues/{this-issue-id}. Read `blockedByIssueIds[]`.

For each blocker ID in `blockedByIssueIds[]`:
  GET /api/issues/{blocker-id} → read `identifier` and `status`

If ANY blocker has status NOT IN {"done", "cancelled", "archived"}:
  POST /api/issues/{this-issue-id}/comments: "Awaiting blockers: {identifier:status for each pending blocker}. No-op exit — will re-run when blockers resolve."
  STOP — do not proceed to STEP 1.


## STEP 0b — Escalation check

Get this Issue's `parentId` (the curator Issue).

GET /api/companies/{companyId}/issues?parentId={curator-issue-id}&limit=20 — find the Validator Issue.

GET /api/issues/{validatorIssueId}/documents — find document with key "validation-report".

If validation-report exists AND its body contains the line `escalated: true`:
  POST /api/issues/{this-issue-id}/comments: "Validation escalated after 3 rework cycles — human review required. Editor blocked pending manual intervention."
  PATCH this Issue `status="blocked"`.
  STOP — do not proceed to STEP 1.

## STEP 1 — Verify all 3 atomizers AND validator are done

Get this Issue's `parentId` (the curator Issue).

GET /api/companies/{companyId}/issues?parentId={curator-issue-id}&limit=20

Find "Threads atomizer", "X atomizer", "Facebook atomizer", and "Validator" Issues.

Verify ALL FOUR are `status="done"`:
- If any atomizer is not done: comment "still waiting for: {platform names}" and PATCH this Issue `status="blocked"`. STOP.
- If the Validator is not done (blocked/in_progress/todo): comment "Validator not yet done (status: {status}) — blocking until validation completes." and PATCH this Issue `status="blocked"`. STOP.

Both conditions must pass before continuing.

## STEP 2 — Read all batch documents

For each of the 3 atomizer Issues, GET their documents:
GET /api/issues/{issue-id}/documents

Retrieve:
- threads-batch document (key: "threads-batch") from Threads atomizer Issue
- x-batch document (key: "x-batch") from X atomizer Issue
- facebook-batch document (key: "facebook-batch") from Facebook atomizer Issue

**If any batch document array is empty** (atomizer wrote to workspace instead of Paperclip), fall back to workspace files:
List /home/node/.openclaw/workspace-writer/ and find files matching *threads-batch*{weekOf}*.md, *x-batch*{weekOf}*.md, *facebook-batch*{weekOf}*.md (use the most recent version). Read those files directly.

Also read the curator's picks document (key: "picks") for metadata: slug, mainImage, scheduled slots (Mon-AM, Mon-PM, etc.), weekOf, picks array, promos array.

Also check for a validation-report document on the Validator Issue sibling (if present) — note any REVISE or FAIL items so you can address them in humanization.

## STEP 3 — Humanize and consolidate

Review all posts (article AND promo). Apply these fixes inline:
1. Remove AI slop phrases: "vibrant tapestry", "morning markets hum", "showcase", "nestled", "boasts", etc.
2. Remove promotional inflation: "absolutely", "amazing", "incredible".
3. Enforce "we" not "I" throughout.
4. Verify character limits: Threads ≤500, X ≤280 each.
5. Verify Facebook has no external links in text.
6. If validation report flags UNVERIFIABLE claims: simplify the claim to remove the uncertain part.
7. If validation report flags HALLUCINATED claims: rewrite that section to remove the hallucinated claim entirely.
8. For promo posts: verify problem-solution voice — the post must start with a pain point, not a product pitch.

## STEP 4 — Write posts-batch document

PUT /api/issues/{this-issue-id}/documents/posts-batch:
```json
{
  "title": "Posts Batch",
  "format": "markdown",
  "body": "..."
}
```

Body format — one section per slot, EXACTLY this structure. Process ALL 14 slots in order (Mon-AM through Sun-PM):

**For article slots:**
```
## {Weekday Mon/Tue/etc} {YYYY-MM-DD} — {slug}

### Threads
{main post text}

{descendant text with link}

### X
{tweet 1}

{tweet 2}

{tweet 3}

{tweet 4 with link}

### Facebook
{post text, no links}
image: https://hinomaru.one{mainImage}

---
```

**For promo slots** (identified by `### PROMO-{slot}` in the atomizer batch docs):
```
## {Weekday Mon/Tue/etc} {YYYY-MM-DD} — PROMOTIONAL (theme: {theme})

### Threads
{main promo post text}

{descendant promo text with → https://hinomaru.one/guided-experiences/}

### X
{tweet 1}

{tweet 2}

{tweet 3}

{tweet 4 with https://hinomaru.one/guided-experiences/}

### Facebook
{post text, no links}
image: https://hinomaru.one/images/guided-experiences.webp

---
```

Map slots to dates: Mon-AM and Mon-PM → Monday of the `weekOf` week, Tue-AM and Tue-PM → Tuesday, etc. Use the picks doc's weekOf to compute the actual calendar dates.

To identify which slots are promo: look for `### PROMO-{slot}` headings in the atomizer batch documents, OR check the `promos` array in the picks document.

## STEP 5 — Create Scheduler + Approval (deterministic)

⚠️ DO NOT call `POST /approvals` or `POST /issues` manually. Run the script — it handles both atomically.

```bash
node /home/node/.openclaw/workspace/scripts/editor-create-approval.js \
  --issue-id {this-issue-id} \
  --posts-batch-file /home/node/.openclaw/workspace-editor/posts-batch-{weekOf}-{mode}.md \
  --title "Content batch {weekOf} ({picksCount} articles + {promoCount} promos) ready for Metricool push" \
  --week-of {weekOf} \
  --picks-count {picksCount} \
  --promo-count {promoCount} \
  --mode {mode}
```

Capture stdout JSON. Extract `approvalId` and `schedulerIdentifier`.

If the script exits non-zero: read stderr, comment the full error on this Issue, PATCH status=blocked. Do NOT retry manually.

## STEP 6 — Post Discord notification

Use `escalate_to_human`:
- `agentName`: "Editor"
- `reason`: "📦 Content batch {weekOf} ready — {picksCount} articles + {promoCount} promos × 3 platforms. Approval {schedulerIdentifier} / {approvalId} pending in Paperclip. Week: {weekOf}. Mode: {mode}."

If this fails: log in a comment and continue — Discord is best-effort.

## STEP 7 — Mark this Issue done

PATCH this Issue `status="done"`.

The scheduler Issue (Kani) remains blocked until the operator approves or rejects.

---

## Hard rules

- STEP 5 script is the ONLY way to create scheduler + approval. Do NOT call POST /approvals or POST /issues directly.
- DO NOT push to Metricool — that is the scheduler's responsibility.
- Mark THIS issue done after the script succeeds (not blocked — editor's work is done).
- Discord posting failure is non-fatal. Log and continue.
- Revision handler (STEP 0): read operator comment carefully — apply specific edits only, do not rewrite everything.
- Promo sections MUST use `## {Weekday} {date} — PROMOTIONAL (theme: {theme})` header format.
- Process ALL 14 slots in posts-batch, not just the 12 article slots.

