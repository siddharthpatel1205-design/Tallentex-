# Tallentex — Supabase Setup Guide

Tallentex now runs entirely on Supabase: Postgres for data, Supabase Auth
for login, Supabase Realtime for live features (via `postgres_changes`
and the Presence API), and Supabase Storage for proctoring snapshots.
No Firebase product is used anywhere in this version.

---

## 1. Create a Supabase project

1. Go to https://supabase.com/dashboard → **New project**.
2. Pick a name, a database password (save it somewhere safe), and a region close to your users.
3. Wait for provisioning to finish (a minute or two).

## 2. Run the database schema

1. In your project, open **SQL Editor** → **New query**.
2. Open `supabase/supabase-schema.sql` from this project, copy the **entire file**, paste it into the editor.
3. Click **Run**.

This single script creates every table, the `is_admin()` helper, the
auto-create-profile trigger, all Row Level Security policies, the
`submit_attempt()` and `log_violation()` server-side functions, the
`proctoring` Storage bucket, and its access policies — everything the
app needs, in the right order.

If anything errors partway through, fix that specific block and re-run
just that section (the whole script is safe to re-run from the top only
if you first drop the tables it created, since `create table` fails on
a table that already exists).

## 3. Configure Authentication

1. **Authentication → Providers** → make sure **Email** is enabled (it is by default).
2. **Authentication → Settings** → while developing, turn **OFF "Confirm email"** so `signUp()` logs a student straight in without waiting for a verification link. Turn this back **ON** before a real launch, and add a proper "check your email" step in `signup.html` if so (a small change in `js/auth.js`, which already handles the "no session yet" case).

## 4. Paste your project keys

1. **Project Settings → API**.
2. Copy the **Project URL** and the **`anon` `public`** key. **Never** copy the `service_role` key into any frontend file — it bypasses every Row Level Security policy in this project.
3. Open `js/supabase-config.js` and paste them in:

```js
const SUPABASE_URL = "https://xxxxxxxx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOi...";
```

This is the only file that needs editing to connect the app to your project.

## 5. Enable Realtime on the tables that need it

The schema script already runs:
```sql
alter publication supabase_realtime add table public.attempts;
alter publication supabase_realtime add table public.message_recipients;
```
Double-check this took effect: **Database → Replication** → confirm
`attempts` and `message_recipients` are toggled on for the
`supabase_realtime` publication. If you ran the schema script
successfully, this is already done — this step is just how to verify it.

## 6. Create the first Admin securely

Tallentex has no admin signup form and never checks a hardcoded email —
admin status lives only in `profiles.role`, and RLS blocks students from
changing their own role (see the `profiles_update_own_non_role_or_admin`
policy). To create your first admin:

1. Sign up a normal account through `signup.html`.
2. Supabase Dashboard → **Table Editor** → `profiles` → find that row.
3. Change `role` from `student` to `admin`. Save.
4. Log in at `admin/index.html` with that account.

For every admin after the first, either repeat this process or write a
Supabase Edge Function (restricted to existing admins) that promotes a
user, so you're not hand-editing the table each time.

## 7. Run the project locally

```bash
cd Tallentex
python3 -m http.server 8080
# open http://localhost:8080
```
(Any static server works — Node's `npx serve`, VS Code's Live Server, etc.
Avoid double-clicking the HTML files directly; some browser APIs are
blocked on the `file://` protocol.)

## 8. Deploy it as a website

Any static host works, since there's no server-side code beyond
Supabase itself — just upload the `Tallentex` folder as-is to Netlify,
Vercel, GitHub Pages, Cloudflare Pages, or your own server.

---

## What changed from a NoSQL design, and why it's actually simpler here

- **No separate "live pointer" table.** In the old Firestore+RTDB
  design, quiz.js had to write progress to two places (Firestore for
  the record, Realtime Database for the live view). Here, the
  `attempts` row **is** the live view — Postgres Realtime pushes its
  own changes straight to the admin's Live Monitor page via
  `postgres_changes`, so there's exactly one place progress is written.
- **Scoring is a single atomic database function**, `submit_attempt()`.
  A row lock (`for update`) inside it means a race between the
  auto-submit timer and a manual click can't double-score an attempt —
  stronger than the client-side transaction the Firestore version used.
- **Presence uses Supabase's Presence API** (a Realtime feature built
  for exactly this), not a table anyone polls. The `public.presence`
  table still exists as a simple, best-effort "last seen" record for
  the Users page — see the honest limitation noted in `js/presence.js`
  about it not being as instantly reliable as the live channel itself.
- **Admin messages need no separate push mechanism.** Inserting a row
  into `message_recipients` is itself the delivery: every logged-in
  student's browser already has a Realtime subscription on their own
  `user_id` (see `js/ui-utils.js`), so the blocking popup appears the
  moment the row lands — no dual-write to a second database.

## Known limitations to review before going live

- **Question confidentiality:** RLS currently lets any signed-in user
  read a `questions` row (including `correct_answer`), since the quiz
  UI needs it to render options. This is the same tradeoff the earlier
  Firestore version had. For a high-stakes deployment, create a
  Postgres **view** that excludes `correct_answer`/`explanation` for
  general reads, and have `submit_attempt()` (already server-side) be
  the only thing that ever sees the real answer.
- **AI Question Generator** expects a Supabase **Edge Function** you
  deploy yourself, holding your AI provider's key server-side. Set its
  URL in `AI_GENERATOR_ENDPOINT` near the top of `js/admin.js`.
- **`public.presence` "last seen" accuracy:** relies on a best-effort
  browser event on tab close, not a server-side disconnect guarantee.
  The live "online now" count elsewhere in the app (Supabase Presence
  channel) does not have this limitation.
- **Admin promotion** is a manual Table Editor edit by design (Step 6).
  For a larger team, build a small Edge Function restricted to existing
  admins instead of hand-editing rows.
