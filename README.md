# SOC Log

A shift log for the Seton Hall SOC. Analysts sign up, get approved by a supervisor, and log every check they run from the SOC best-practices list. Supervisors see all team activity, review escalations, track checklist coverage, and manage who has access.

- **Front end:** plain HTML/CSS/JS with no build step, hosted on GitHub Pages
- **Back end:** [Supabase](https://supabase.com) (free tier): auth and a Postgres database
- **Sign-in:** email + password, SHU Microsoft, Google, passkeys, or an emailed sign-in link. **Every account also needs a 6-digit Duo Mobile code** (2-step verification), and the database enforces it.
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
4. Open another new query, paste `supabase/auth_upgrade.sql`, and click **Run**. This turns on database-enforced 2-step verification.

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

## Sign-in options

| Method | Status | Setup needed |
|---|---|---|
| Email + password | On | None |
| Emailed sign-in link | On | None (Supabase's free email sender is rate-limited; add SMTP for a team) |
| Passkeys (Face ID / Touch ID / Windows Hello) | On (Supabase beta) | Already configured. Users add one under **Account > Passkeys** |
| **Duo Mobile 2-step codes** | **Required for everyone** | None. Users scan a QR code into Duo Mobile the first time they sign in |
| SHU Microsoft (Entra ID) | Button appears once enabled | Needs an Entra app registration (below) |
| Google | Button appears once enabled | Needs a Google OAuth client (below) |

The Microsoft and Google buttons only show up after the provider is switched on in Supabase. The page checks automatically.

### How 2-step verification works
- The first time someone signs in (any method), they scan a QR code with **Duo Mobile** (or any authenticator app) and type the 6-digit code.
- Every sign-in after that asks for the current code.
- The **database** checks it. Until the code is verified, the session can't read logs, the checklist or other people, and it can't write anything. A stolen password alone gets nothing.
- Lost phone: a supervisor clicks **People > Reset 2-step** (it's written to the audit trail). The person scans a new QR code at their next sign-in.
- This uses Duo Mobile's code generator, not Duo push. For real Duo push, use SHU Microsoft sign-in (SHU's Duo policy applies there) or add Duo as a custom OIDC provider in Supabase.

### Turn on SHU Microsoft sign-in
Someone with admin rights in SHU's Microsoft Entra tenant does this:
1. In the **Entra admin center** go to **App registrations > New registration**. Name: `SOC Log`. Supported account types: **this organization only (single tenant)**.
2. Redirect URI (Web): `https://sftstmzbjnlzhmsnflog.supabase.co/auth/v1/callback`
3. Under **Certificates & secrets**, create a client secret. Copy the **Value**.
4. Copy the **Application (client) ID** and **Directory (tenant) ID** from the Overview page.
5. In Supabase go to **Authentication > Sign In / Providers > Azure**. Turn it on and paste the client ID and secret. Set **Azure Tenant URL** to `https://login.microsoftonline.com/<tenant-id>`. Save.

Because the app is single-tenant, only SHU accounts can use it, and SHU's Conditional Access / Duo policy runs during that login.

### Turn on Google sign-in
1. In **Google Cloud Console > APIs & Services > Credentials**, create an **OAuth client ID** (type: Web application). Configure the consent screen first if it asks.
2. Authorized JavaScript origin: `https://seif-abdelhamid.github.io`
3. Authorized redirect URI: `https://sftstmzbjnlzhmsnflog.supabase.co/auth/v1/callback`
4. In Supabase go to **Authentication > Sign In / Providers > Google**. Turn it on, paste the client ID and secret, and save.

Google accounts that aren't on the allowed email domain are still refused at sign-up by the database.

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
supabase/auth_upgrade.sql   Database-enforced 2-step verification + supervisor 2-step reset
```
