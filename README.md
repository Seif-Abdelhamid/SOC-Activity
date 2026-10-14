# SOC Log

A shift log for the Seton Hall SOC. Analysts sign up, get approved by a supervisor, and log every check they run from the SOC best-practices list. Supervisors see all team activity, review escalations, track checklist coverage, and manage who has access.

- **Front end:** plain HTML/CSS/JS with no build step, hosted on GitHub Pages
- **Back end:** [Supabase](https://supabase.com) (free tier): email + password auth and a Postgres database
- **Security:** enforced in the database with row-level security, not in the browser (see `supabase/schema.sql`)

## What each role can do

| | Analyst (student) | Supervisor |
|---|---|---|
| Sign up / sign in / reset password | ✓ | ✓ |
| Log a check | ✓ (only after approval) | ✓ |
| See their own log entries and supervisor reviews | ✓ | ✓ |
| See everyone's entries, overview stats, coverage | | ✓ |
| Approve, decline, remove, restore people, change roles | | ✓ |
| Review escalations, export CSV | | ✓ |
| Edit the checklist, settings | | ✓ |
| See the audit trail of access changes | | ✓ |

How the database enforces it:
- New accounts start as **pending** and can't log anything until a supervisor approves them.
- Only emails from the allowed domain (`shu.edu` by default) can sign up.
- Every entry is stamped with the logged-in user and **the server's clock**. The browser can't set either one.
- Nobody can edit or delete a saved entry, supervisors included.
- **Removed** users can still sign in but can't log anything or see any data.
- Supervisors can't change their own access, so the team can't lock itself out.
- Access changes, reviews and checklist edits are written to an audit trail.

## Try it without setting anything up

Open the site with `?demo` at the end of the address, or just open it before `js/config.js` is filled in. You'll see realistic sample data and a bar to switch between the supervisor and student views. Nothing is saved in demo mode.

## Setup (about 15 minutes)

### 1. Create the Supabase project
1. Sign up at supabase.com and click **New project**. Name it `soc-activity`, pick a strong database password (save it somewhere), and choose the region closest to you (East US).
2. When the project is ready, open **SQL Editor > New query**, paste the whole contents of `supabase/schema.sql`, and click **Run**. You should see "Success. No rows returned".
3. Open another new query, paste `supabase/seed_practices.sql`, and click **Run**. This loads the 39 checks.

### 2. Connect the website to it
1. In Supabase go to **Project Settings > API** (or **Connect**). Copy the **Project URL** and the **anon / publishable** key.
2. Put both in `js/config.js`:
   ```js
   export const SUPABASE_URL = "https://xxxxxxxx.supabase.co";
   export const SUPABASE_ANON_KEY = "eyJ...";   // or sb_publishable_...
   ```
   The anon key is meant to be public. **Never** put the `service_role` / secret key in this repo.
3. Commit and push.

### 3. Turn on GitHub Pages
1. In the GitHub repo go to **Settings > Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and click **Save**.
3. After a minute the site is live at `https://<your-username>.github.io/SOC-Activity/`.

### 4. Tell Supabase where the site lives
In Supabase go to **Authentication > URL Configuration**:
- **Site URL:** `https://<your-username>.github.io/SOC-Activity/`
- **Redirect URLs:** add the same address.

Without this, the links in the confirmation and password-reset emails won't work.

### 5. Create your supervisor account
Open the site and click **Create an account**. **The first account ever created automatically becomes the supervisor**, so do this yourself before sharing the link. Confirm your email, then sign in.

### 6. Add your team
Send the site link to your students. When they sign up, they show up under **People > Pending**. Click **Approve** and they can start logging.

## Good to know
- **Email limits:** Supabase's built-in email sender only sends a few emails per hour on the free plan. If several students sign up at once, some confirmation emails may be delayed. For a team, connect your own SMTP under **Authentication > Emails > SMTP Settings**, or temporarily turn off **Confirm email** under **Authentication > Providers > Email** while onboarding. Supervisor approval still protects the app.
- **Free projects pause** after about a week with no activity. Daily use keeps the project awake. If it pauses, click **Restore** in the Supabase dashboard.
- **Removing someone completely:** **Remove** in the app blocks them immediately but keeps their past entries as evidence. To delete the login itself, go to Supabase **Authentication > Users**.
- **Backups / evidence:** use **Activity > Export CSV** for a dated copy of the log. Entries are also in the `check_logs` table in Supabase.
- **Allowed domain:** change it under **Settings** in the app.

## Files
```
index.html                  App shell
css/app.css                 Styles (light + dark)
js/config.js                Your Supabase URL + anon key
js/api.js                   Data layer (Supabase or demo)
js/app.js                   Screens: auth, logging, overview, activity, coverage, people, checklist, audit, settings
data/practices.json         Checklist used by demo mode
supabase/schema.sql         Tables, triggers and row-level security
supabase/seed_practices.sql The 39 SOC checks
```
