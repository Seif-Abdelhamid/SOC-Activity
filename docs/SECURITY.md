# SOC Log security review

A short review of the app against the office's own standards. Re-check this list whenever the schema, the functions or the sign-in options change.

## What it protects

| Data | Sensitivity | Who can read it |
|---|---|---|
| Log entries (what was checked, notes, tickets) | Internal. Can mention hosts, usernames and incidents | The author, and supervisors |
| Evidence files (screenshots, exports) | Internal, may show user data | The uploader, and supervisors |
| Tool snapshots (counts from CrowdStrike, Defender, Duo, Abnormal) | Internal, counts only, no user data | The analyst who took it, and supervisors |
| Shift handoffs | Internal | All active, 2-step-verified team members |
| Profiles (name, email, role) | Internal | Yourself; supervisors see everyone; teammates see names only |
| Audit trail | Internal | Supervisors |
| Vendor API keys, Teams webhook, Splunk token | Secret | Nobody in the app. Stored as Supabase function secrets |

## Controls in place

**Identity**
- University email domain enforced by the database at sign-up.
- New accounts can do nothing until a supervisor approves them.
- 2-step verification (TOTP, e.g. Duo Mobile) is enforced by the database: a password-only session can't read or write anything.
- Supervisors can't change their own role or status, so the team can't lock itself out or self-escalate.

**Authorization (row-level security, tested in `tests/rls_tests.sql` on every push)**
- Analysts insert entries only as themselves, and read only their own.
- Log entries and handoffs can't be edited or deleted by anyone through the API. Supervisor reviews can be updated, and every update is audited.
- The server, not the browser, stamps who logged an entry and when.
- Attachments must sit in the uploader's own storage folder; a tool snapshot must belong to the same person and be under 2 hours old.
- Vendor APIs are only called by a server function, with read-only credentials; the browser never sees a key.

**Accountability**
- Access changes, role changes, 2-step resets, reviews, shift and checklist edits are written to the audit trail by database triggers.
- Everything can be forwarded to Splunk, giving a copy outside the app that app users can't change.

**Data handling**
- Notes show a reminder not to paste passwords, MFA codes, FERPA records, HR or medical details, and the form blocks obvious patterns (SSNs, `password: …`, card numbers).
- Retention is configurable (Team settings); a daily job deletes entries older than the setting.

## Known gaps (and what would close them)

| Gap | Risk | Fix |
|---|---|---|
| Runs on a personal GitHub and a free Supabase project | Loss of access when the owner leaves; no backups; project pauses when idle | Move to an SHU-owned org and Supabase Pro (or SHU-hosted Postgres) |
| Password and email-link sign-in still allowed | Weaker than SSO; no automatic offboarding | Make SHU Microsoft (Entra) the only sign-in; grant access by Entra group |
| Supabase's default email sender | Rate-limited; emails come from a non-SHU address | Configure SHU SMTP in Supabase Auth |
| The browser clock sets "performed at" (up to 7 days back) | An analyst could claim a check happened earlier than it did | The server save time is always shown next to it; long gaps are flagged |
| Evidence files aren't malware-scanned | A malicious file could be uploaded by a member | Only images, PDF, CSV and text are accepted, files are never executed, and downloads are served from Supabase's domain |
| Supervisors can delete shifts and checks' owners | Changes to planning, not to records | All such changes are audited |

## Before going live, confirm

- [ ] `tests` workflow is green on `main`.
- [ ] `auth_upgrade.sql` and `upgrade_v2.sql` have been run (Database > Tables shows `handoffs`, `shifts`, `tool_snapshots`).
- [ ] Every vendor API credential is read-only and scoped to the minimum listed in the README.
- [ ] The `SENTINEL_KEY` is long and random (`openssl rand -hex 32`), and stored only in function secrets, Vault and (optionally) GitHub secrets.
- [ ] Supabase > Authentication > URL Configuration only lists the GitHub Pages address.
- [ ] Only the anon / publishable key is in `js/config.js`.
