-- Per-teammate "send from" email address. When set (and the domain is
-- authenticated in the GHL sub-account), outbound emails go out as this
-- address instead of the sub-account's default sender. Nullable/plain text,
-- same style as other additive profile columns. Admin-managed via TeamPanel.
alter table profiles add column if not exists send_from_email text;
