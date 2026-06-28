-- ─────────────────────────────────────────────────────────────────────────────
-- 0014_notifications_delivery.sql  — SAFE to apply now.
--
-- The admin panel broadcast history could never show WHY a push failed. Each
-- send inserted the history row with status_label = 'sent' BEFORE the push was
-- attempted, and never wrote the outcome back. So every row read as 'sent',
-- even total failures.
--
-- The send functions now insert the row as 'sending', then UPDATE it with the
-- final state ('delivered' | 'partial' | 'failed' | 'no_tokens') plus the
-- failure reason. status_label already exists; this adds the reason column.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS delivery_error text;
