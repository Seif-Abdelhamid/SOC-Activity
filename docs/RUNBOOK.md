# SOC Log runbook

What to do when something goes wrong. Each entry says how you'll notice, what to check, and how to fix it.

## The site won't load

**You'll notice:** the Uptime workflow fails and GitHub emails you, or people report a blank page.

1. Open the site in a private window. If GitHub Pages itself is down, check githubstatus.com and wait.
2. If the page loads but shows "The SOC log couldn't start", open the browser console (F12). A bad edit to `js/config.js` or a script error is the usual cause.
3. Undo the last commit on `main` if it broke things: GitHub > Commits > the commit > **Revert**.

## Everyone gets "Can't reach the server"

**You'll notice:** Uptime fails on the "Supabase is awake" step.

1. Open supabase.com/dashboard. A free project that sat unused for about a week gets **paused**. Click **Restore project** and wait 2–3 minutes.
2. If it isn't paused, check status.supabase.com.
3. Nothing is lost while the project is paused. Analysts should write their checks down and log them within 7 days of doing them; the app accepts backdated entries up to 7 days.

## Someone lost their phone (2-step verification)

1. Confirm it's really them: in person, or by a call to a number you already have. Never through the same email account.
2. Team > Members > their row > **Reset 2-step**. This is recorded in the audit trail.
3. Next time they sign in, they scan a new QR code in Duo Mobile.

## Someone leaves the team

1. Team > Members > **Remove**. They can't log in to anything useful from that moment. Their past entries stay.
2. If they owned checks, the Checklist page shows them as owner until you reassign. Reassign them the same day.
3. If they were on a shift, edit the shift and untick them.

## A supervisor account is compromised

1. Another supervisor removes the account immediately (Team > Members > Remove).
2. In Supabase: Authentication > Users > the user > **Sign out user** (kills existing sessions), then reset their password.
3. Review Team > Audit trail for anything they changed: approvals, role changes, checklist edits, reviews.
4. Saved log entries can't be edited or deleted, so the record of the team's work is intact.

## Teams alerts stopped

1. Supabase > SQL Editor: `select status_code, content::text, created from net._http_response order by created desc limit 5;`
   * No rows: the schedule isn't running. Re-run `supabase/schedule.sql`.
   * 401: the key in Vault doesn't match the `SENTINEL_KEY` function secret. Set them to the same value.
   * 200 but the content shows `error:` next to `escalations`: the Teams webhook URL is wrong or the Teams workflow was turned off. Create a new one and update `TEAMS_WEBHOOK_URL`.
2. Escalations are never lost: anything not yet alerted is sent on the next successful run, for up to 24 hours.

## Splunk isn't receiving events

1. Check the same `net._http_response` rows for `splunk: error: …`.
2. Common causes: the HEC token was disabled or rotated, or the HEC URL isn't reachable from the internet. Supabase calls Splunk from the cloud, so HEC must be exposed or relayed.
3. Forwarding resumes where it left off; the cursor is only advanced after Splunk accepts a batch.

## "Pull numbers from …" fails

* "isn't connected yet": that tool's API keys aren't in the function secrets. See README > Integrations.
* "Couldn't reach …": the vendor API rejected the call. In Supabase > Edge Functions > snapshot > Logs, the error shows the HTTP status. 401/403 almost always means an expired secret or a missing API scope.
* Analysts can always log the check without a snapshot and attach a screenshot instead.

## Restoring data

* Supabase Pro keeps daily backups (Database > Backups). The free plan does not, which is one of the reasons to move to Pro (see README).
* Monthly report CSVs (Reports > Export CSV) and Splunk are your independent copies. Export the report on the first of every month.
