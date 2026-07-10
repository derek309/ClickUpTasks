# ClickUpTasks — Activation runbook

Five big features were built and are code-complete. Each **works in the app today**
except for the parts below that need something only you can do (run SQL, add a
key, flip a GHL scope, create a bucket). Do these in order; each is a few minutes.

Nothing here is destructive. The app keeps working if you do none of it — these
steps just *activate* the new capabilities.

---

## 1. GoHighLevel two-way task sync  ← the strategic one

Tasks you create here can now be pushed **into GoHighLevel** as native tasks on
the contact, and stay in sync: edit the title/description/due/status here and it
updates in GHL; complete it here and it's completed there; delete or "Unlink" and
it's removed there.

**What you need to do:** make sure each sub-account's Private Integration token
has the **Tasks** scope (you already enabled Contacts).

1. In GHL, for **each** sub-account (Agency **and** Directory):
   Settings → Private Integrations → open your existing integration (or create one).
2. Ensure both **View Tasks** and **Edit Tasks** scopes are checked, save.
3. If GHL forces a new token when you change scopes, copy the new `pit-…` token,
   then in ClickUpTasks → **Settings** paste the Location ID + new token → **Connect**.

**How to test:** open any task on a client → in the drawer, **Push to GHL**. Then
in GHL open that contact → Tasks tab → it should be there. Change the due date
here; refresh GHL; it updates.

*If a task shows "Not linkable," that client's contact has no location/GHL id —
re-sync contacts in Settings.*

---

## 2. Row-Level Security (before you add VAs)

Right now the database is open to any signed-in user. This locks it down: **admins
see everything; VAs see only the clients/projects/tasks assigned to them.**

1. Supabase → SQL Editor → paste all of [`supabase/rls.sql`](../supabase/rls.sql) → **Run**.
2. Add the **service-role key** to `.env.local` (see step 4) — required so the
   server can still sync GHL contacts and manage the team once RLS is on.
3. Restart the dev server / redeploy.

**How to test:** sign in as yourself (admin) — everything still shows. Have a VA
sign up; in **Team**, give them a roster identity + assign them a task; when they
log in they should see only that.

---

## 3. Real file attachments

Attachments now upload to Supabase Storage and download via secure, short-lived
links (instead of being name-only placeholders).

1. Supabase → Storage → **New bucket** → name it exactly `task-files` → leave
   **Public OFF** (private) → create.
2. SQL Editor → paste [`supabase/storage.sql`](../supabase/storage.sql) → **Run**.

**How to test:** open a task → Attachments → drop a file. It uploads; click its
name to download. (Before the bucket exists you'll get a toast telling you to
create it — no crash.)

---

## 4. Service-role key (unblocks Team roles + steps 1–2's server side)

The Team panel (admin/VA editing) and server-side GHL contact sync need Supabase's
**service-role** secret.

1. Supabase → Project Settings → API → **service_role** secret (starts `sb_secret_`
   or is labelled `service_role`). **Never** put this in any `NEXT_PUBLIC_` var.
2. In `.env.local` add:  `SUPABASE_SERVICE_ROLE_KEY=sb_secret_…`
3. Restart the dev server.

**How to test:** open **Team** — the roster loads and you can toggle admin/VA.

---

## 5. GoHighLevel email messaging (send + receive)

Open a contact (a "cl_" client in the sidebar) → **Messages** tab: compose and send
a real email, which goes out from that sub-account's own connected GHL email, not
a separate provider. When they reply, it shows up in that same thread
automatically — no polling, GHL pushes it to you.

**What you need to do**, per sub-account (same Private Integration token as step 1):

1. In GHL: Settings → Private Integrations → your existing integration → make
   sure a **Conversations / Messages** write scope is checked (alongside the
   Tasks scope from step 1) → save. Paste any new token into Settings the same
   way as step 1 if GHL forces a new one.
2. Supabase → SQL Editor → paste all of [`supabase/messages.sql`](../supabase/messages.sql)
   → **Run**. (Needs `rls.sql` and `realtime.sql` run first — see their own steps.)
3. In GHL, for **each** sub-account: Automation → create a **second** Workflow,
   trigger **"Customer Replied"** → action **"Webhook"** → same URL you used for
   step 1's task-sync Workflow (`https://<your-app>/api/ghl/webhook?secret=<GHL_WEBHOOK_SECRET>`),
   but with the webhook action's JSON body set to exactly:
   ```json
   { "event": "message_reply", "contactId": "{{contact.id}}", "channel": "email",
     "subject": "{{message.subject}}", "body": "{{message.body}}", "messageId": "{{message.id}}" }
   ```
   (The webhook route tells the two Workflows apart by this `event` field, so the
   one URL + secret serves both without conflict.)

**How to test:** open any contact → **Messages** → send yourself a short email →
confirm it lands in your inbox from the sub-account's GHL address. Reply to it →
within a few seconds it should appear in the same thread here.

*If the Messages tab says "not linked to a GoHighLevel contact yet," that
contact has no `ghlContactId` — re-sync contacts in Settings (same fix as
"Not linkable" in step 1).*

*SMS is not built yet — the schema and UI already carry a `channel` field for
it, so it's a second pass on top of this, not a rebuild.*

---

### Order that avoids friction
4 (add key) → 2 (run rls.sql) → 3 (bucket + storage.sql) → 1 (GHL Tasks scope) → 5 (messages.sql + Conversations scope + Customer Replied workflow).
Doing the key first means the moment RLS turns on, the server can still work.
