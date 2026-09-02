# HomeCare Mumbai — Pilot MVP Project Brief

This file is the source of truth for what this project is and is not. Read it before making
any change to this repository or its backend. If a request conflicts with this file, flag the
conflict instead of silently picking a side.

## 1. What this is

HomeCare Mumbai is a small, real, already-operating home healthcare business (via Accura
Diagnostics), registered/based in Powai. It sends nurses, doctors, physiotherapists, and
wound/stoma specialists to patients' homes, plus at-home diagnostics and video consultations.

**Public-facing geography:** the website deliberately says "Serving Mumbai" — it does not
name specific areas (Powai/Andheri/Vikhroli/Ghatkopar), and the booking form's area field is
free text, not a restricted dropdown, so no genuine Mumbai inquiry is turned away at the door.
**Operational reality:** on-the-ground provider strength is still concentrated in the original
catchment (Powai, Andheri, Vikhroli, Ghatkopar) as of this writing — the Operations Admin is
expected to confirm feasibility per request for anywhere else, the same way they confirm any
other detail before quoting. This is a deliberate, informed choice, not an oversight — don't
"fix" the copy back to the named areas, and don't assume actual coverage matches the marketing
without checking with the founder first if it becomes operationally relevant (e.g. building
provider `service_areas` lists).

This is a **pilot MVP for an experimental startup**, not enterprise healthcare software.
Design for tens of providers and hundreds of active patients — not millions. Keep the data
model clean enough to grow later, but do not build for a scale that does not exist yet.

**The guiding question for every feature decision:**
"Can a small team reliably receive, assign, deliver, record and reconcile 10–30 home-care
activities per day without depending on someone's memory or a diary?"
If a proposed feature doesn't serve that question directly, it waits for a later version.

## 2. Backend decision (confirmed)

**Appwrite is the single backend.** Not Supabase. Do not introduce Supabase, and do not mix
this project with any other backend or with the separate SurgeonPro Appwrite project.

- Appwrite Cloud project: **HomeCare** (verify project ID/name before any operation — never
  assume, always confirm against the live project first).
- GitHub repository: `drnitujain-cpu/homecaremumbai.github.io` — source of truth for code.
- Hosting: existing Netlify deployment (`homecaremumbai.netlify.app` and/or a custom domain)
  — preserve it, do not create a new site or change its deployment configuration.
- Notifications: Telegram (via BotFather) is the primary real-time alert channel, plus email
  as a second channel — both free, both live from the first backend milestone (see §9).
  WhatsApp stays as the manual patient-facing fallback it already is. PWA push notifications
  are deferred until the core workflow (request → assign → complete → pay) is proven — they
  need their own subscription storage and are not worth the complexity yet.

## 3. The three roles (not eight)

Earlier drafts considered separate Receptionist / Rota Manager / Coordinator / Accountant /
Supervisor roles. For V1, collapse these into one operational role. Roles can be split apart
later without redesigning the database — permissions are the thing that changes, not the
data model.

1. **Public patient/family** — no login required to request care.
2. **Care Provider** — nurse, doctor, physiotherapist, wound/stoma specialist, other approved
   home-care provider. Small profile, availability, assigned jobs, accept/decline, complete
   visit with a short observation.
3. **Operations Admin** — owner/coordinator/receptionist/authorized backup sharing one
   practical system: receive requests, contact patient, review/confirm, quote, assign
   provider, manage replacement, record actions on a provider's behalf when necessary,
   monitor visits, track patient payment and provider payable.

## 4. Core workflow

```
Patient/Family
  → Request Care (public website, no login)
  → Operations Admin reviews / contacts / confirms
  → clinical review only when required (flag, not a triage module)
  → quote / confirm
  → select suitable available provider (manual, coordinator-controlled — no auto-matching)
  → provider accepts OR coordinator records acceptance on provider's behalf
  → home visit / service
  → provider completes visit with a short observation
  → patient payment tracked / provider payable tracked (kept separate)
  → close
```

For chronic/recurring care, the same shape nests under an episode:

```
Patient → Care Episode → Visits (many) → Assignments → Completion → Payments
```

A one-time visit does **not** require an episode — it attaches to the patient directly.

## 5. Data model (Appwrite database `homecare`)

Six tables/collections only. Do not add a table because it might be useful someday.

1. **`patients`** — `full_name`, `phone`, `alternate_phone` (optional), `address`, `area`,
   `brief_condition` (optional, plain text), `created_at`. Appwrite-generated row IDs — phone
   number is never used as a primary key.

2. **`care_episodes`** — optional grouping for recurring/chronic care.
   `patient_id`, `title`, `status` (`active`/`closed`), `opened_at`, `closed_at`.

3. **`visits`** — one row = one job, standalone or under an episode.
   `reference_code`, `patient_id`, `episode_id` (optional), `service_type`, `request_source`
   (`website`/`phone`/`whatsapp`/`doctor_referral`/`hospital_referral`/`other`),
   `requested_date` (optional), `requested_time_slot` (optional),
   `duration_or_frequency` (optional), `area`, `address`, `request_notes` (optional),
   `clinical_review_required` (boolean), `status`, `assigned_provider_id` (optional),
   `coordinator_notes` (optional), `completion_observation` (optional),
   `concern_flag` (boolean), `next_visit_note` (optional), `created_at`, `updated_at`.

   Status values (only these): `new_request → contacted → confirmed → assigned →
   in_progress → completed → cancelled` (with `needs_replacement` as a side-exit before
   completion). **Completed visits are not edited** except to add `next_visit_note` or
   resolve a linked issue — history stays stable.

4. **`providers`** — `full_name`, `phone`, `provider_type` (nurse/doctor/physio/wound-stoma
   specialist/other), `skills` (multi-select tags — one service can be covered by more than
   one provider type), `service_areas` (multi-select), `availability_note` (simple
   day/time-of-day/area checkboxes — no calendar engine, no rostering algorithm),
   `active_status` (`active`/`inactive`/`pending_verification`), `payout_rate_note`,
   `preferred_by_patients` (optional, supports continuity of care).

5. **`payments`** — one row per visit, receivable and payable kept in the same record but
   clearly separate fields: `visit_id`, `patient_receivable_amount`,
   `patient_payment_status` (`pending`/`partial`/`paid`), `provider_payable_amount`,
   `provider_payment_status` (`pending`/`paid`), `notes`. This is an operational tracker
   ("who owes us, whom do we owe") — not accounting or payroll software.

6. **`issues`** — one lightweight table for any concern type. `visit_id`, `issue_type`
   (`clinical_concern`/`service_complaint`/`late_or_no_show`/`payment_issue`/`other`),
   `description`, `status` (`open`/`resolved`), `raised_by` (`patient`/`provider`/
   `coordinator`), `created_at`.

Relationships:
```
patient (1) ──< care_episode (0..many, optional) ──< visit (many)
patient (1) ─────────────────────────────────────< visit (many, direct, no episode)
provider (1) ──< visit (many, via assigned_provider_id)
visit (1) ──── payment (1)
visit (1) ──< issue (0..many)
```

## 6. Explicitly NOT in V1

Do not build, even if it seems small or tempting mid-task:

- Patient login/portal, family accounts, in-app chat
- Full EHR or detailed clinical documentation
- AI chatbot, AI triage, AI-driven anything
- Automatic provider assignment/matching, scoring algorithms
- GPS/live tracking, route optimization
- Complex rostering or a calendar/scheduling engine
- Public provider marketplace, public ratings
- Payroll, full accounting/invoicing, inventory, insurance, hospital integrations, CRM,
  subscription engine, advanced analytics
- A second backend (Supabase or otherwise) — Appwrite only
- Separate Receptionist / Rota / Accountant / Supervisor apps (permissions split can come
  later; the data model already supports it)

Availability is a simple checkbox grid (days × time-of-day × areas), not a scheduling
algorithm. Provider matching is a manual filtered list (service + area + available) that the
coordinator picks from — never automatic. Clinical safety is two flags
(`clinical_review_required`, `concern_flag`) that a human acts on — never an AI triage model.

## 7. What stays manual (the software does not decide these)

Whether a request is accepted, clinical suitability, final provider assignment, replacement
provider choice, final quotation, discounts/adjustments, complaint resolution, clinical
escalation, and payment reconciliation. Software removes the memory/diary/coordination
burden — it does not make judgment calls.

## 8. Security baseline

- No Appwrite API key, project secret, or privileged credential ever appears in `index.html`,
  client-side JavaScript, GitHub, or Netlify's public build output.
- Public website submissions never write to Appwrite directly from the browser — they go
  through one server-side function (Netlify Function) that validates input and writes with
  server-held credentials.
- `patients` and `visits` (and every other collection) have no public read, create, update,
  or delete access. Only the server-side function and authenticated Operations Admin/Provider
  roles (once those logins exist) can touch them.
- Every credential handoff happens via environment variables set directly in the user's own
  terminal or in the Netlify dashboard — never pasted into any chat.

## 8a. Operations Admin app (`admin.html`) — live as of this build

A separate, private page at `/admin.html` (linked from nowhere on the public site, not in
its nav) gives the Operations Admin a real login and a list/edit view over `visits` (with
patient info joined in for display). This is the first slice only:

- **Auth**: Appwrite email/password sessions (`account.createEmailPasswordSession`) — no API
  key of any kind in this page's code. Each coordinator needs their own Appwrite Auth user,
  created manually in the Appwrite console (Auth → Create user).
- **Access control**: the `patients` and `visits` tables have a table-level `Users` role
  granted (Read/Create/Update) — any signed-in Appwrite user in this project can read/write
  them. `Row security` is left OFF so this table-level grant applies uniformly. This is
  intentionally coarse (fine for one coordinator) — if more than one Operations Admin account
  is ever created, revisit whether finer-grained permissions are worth the added complexity.
- **What it does today**: list all visits (newest first), filter by status, open one to edit
  `assigned_provider_id` (dropdown of providers), `status`, `coordinator_notes`,
  `completion_observation`, and `concern_flag`. A **Providers** tab lists/creates/edits
  provider profiles (`providers` table — full_name, phone, provider_type, skills,
  service_areas, availability_note, active_status, payout_rate_note). Same `Users`-role,
  no-row-security permission pattern as `patients`/`visits`.
  A "✓ Mark Completed" quick action on each non-closed booking pre-sets status to
  `completed` and focuses the observation field; saving with status `completed` and an
  empty observation is blocked client-side (the short observation is required, per §4/§6).
  A **Payments** block inside the same detail panel edits the visit's one `payments` row
  (created on first save if it doesn't exist yet) — patient receivable amount + status
  (pending/partial/paid) and provider payable amount + status (pending/paid), kept as
  separate fields per §5. Payment status shows as badges on each booking card.
  An **Issues / Concerns** block inside the same panel lists all issues logged against
  that visit (type, description, raised-by, open/resolved) with a "Mark Resolved" button
  per open one, plus a small form to log a new issue immediately (its own action, not tied
  to the main Save Changes) — matches the `issues` table's one-to-many-per-visit shape
  from §5. Open-issue count shows as a badge on the booking card.
- **What it does NOT do yet**: no provider accept/decline flow — that's the one remaining
  piece from the original workflow, whenever it's worth adding.

## 9. Notification channels (coordinator-facing, free tier)

The public website's booking function fires these alongside saving the request — best effort,
never blocking or breaking the patient's booking response:

- **Telegram (primary)** — a bot created once via Telegram's `@BotFather`, posting new-request
  alerts (and eventually assignment/completion/payment events) to the coordinator's chat.
  Free, instant, no domain or DNS needed. Configured via `TELEGRAM_BOT_TOKEN` and
  `TELEGRAM_CHAT_ID` server environment variables — never in client code or Git.
- **Email (secondary)** — sent to the coordinator's own inbox via a free-tier transactional
  email API (e.g. Resend's free tier), configured via a server-side API key env var. Treated
  as a backup channel, not the primary alert — Telegram is faster and needs no inbox-checking
  habit to build.
- **WhatsApp (manual, unchanged)** — stays exactly as it already works: the patient's own
  fallback action, and the pre-filled message a coordinator can forward. Not automated.
- **PWA push** — deferred (see §2).

If a notification channel's credentials are missing or it fails, the booking itself must
still succeed or fail on its own merits — notifications are additive, never a dependency of
the core save.

## 10. Visual design language

Premium-medical, not decorative: calm, high-contrast, uncluttered. Concretely —

- Cool, restrained palette: deep clinical teal as the primary color, a muted gold used
  sparingly (price tags, reference codes) — not as a competing second brand color.
- Solid, crisp white/near-white cards with a thin border and soft shadow — not translucent
  "glass" panels, which read as decorative rather than clinical.
- No decorative background motion (animated blobs, gradients-for-their-own-sake). Visual
  calm reads as trustworthy for a healthcare product; visual noise undermines it.
- One CTA per decision point. Don't repeat the same WhatsApp/Call pair in five places on one
  page — one persistent bottom navigation (Home / Services / Book / Pay / Contact) plus one
  reusable "Contact" action sheet covers it.
- Text contrast is a requirement, not a nice-to-have: body text must be easily readable in
  direct sunlight on a phone, since that's how most patients' families will read it.

## 11. Working process for any future session

1. Confirm the Appwrite project name/ID actually matches "HomeCare" before any read or write
   — stop and ask if it can't be confirmed. Never touch anything resembling SurgeonPro.
2. Inspect before changing. State findings before proposing code.
3. Build one small, reviewable step at a time. Do not bundle unrelated changes.
4. Do not commit, push, or deploy without the founder's explicit go-ahead for that step.
5. Do not create Appwrite databases/collections/attributes/buckets/functions/users, and do
   not install packages, without saying so first and getting confirmation.
6. Keep the existing public website's design and working parts (WhatsApp, Call, layout)
   untouched unless a specific approved step requires changing them.
6a. The site has a service worker (`sw.js`) that caches pages aggressively (registered by
    `index.html`, scope covers the whole site including `admin.html`). **Bump its `CACHE`
    version string on every change to `index.html`, `admin.html`, or `manifest.json`** —
    otherwise returning visitors/coordinators stay stuck on an old cached version after a deploy.
7. Report plainly, in non-technical language: what was found, what was done, what still
   needs a human decision, and exactly one recommended next step — not a menu of options.
