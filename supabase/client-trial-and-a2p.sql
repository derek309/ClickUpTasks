-- ClickUpTasks — three per-client fields that pull apart things `clients`
-- was previously conflating. Run once.
--
-- in_trial / trial_ends_at: the 14-day trial window, which opens the moment a
-- deal actually closes (card on file). `status` could never express this —
-- it's a fulfillment stage (where the work has got to), not a sales moment,
-- so a business that had just been won and one that had been running for a
-- year were both simply "active_client". Stamped once, at the transition that
-- promotes a prospect onto the roster (setClientStatus in Cockpit.tsx), and
-- never re-stamped by a later save, so the window can't slide forward on a
-- routine edit. TRIAL_DAYS (src/lib/data.ts) owns the length.
--
-- does_a2p: whether this business actually markets over SMS, which gates
-- whether the A2P registration steps and the dedicated email domain step get
-- created for it at all (reconcilePlaybookTasks, and its server twin
-- playbookReconcileServer.ts). Every client used to get all five regardless,
-- which buried the steps that matter under setup work most of them will never
-- do. Defaults false, so the extra work is opted into deliberately. Existing
-- A2P task rows are untouched by this change — the gate only decides what is
-- created from here on.
--
-- clientToRow writes all three columns on every client upsert, so these must
-- exist before the app is deployed — same migrate-before-deploy shape as
-- client-request-new-tasks.sql. No RLS change needed: clients_write (rls.sql)
-- is already admin-only.

alter table clients add column if not exists in_trial boolean not null default false;
alter table clients add column if not exists trial_ends_at timestamptz;
alter table clients add column if not exists does_a2p boolean not null default false;
