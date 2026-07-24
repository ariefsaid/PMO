-- 0151_m365_ciphertext_envelope_check.sql — make the HIGH-A1 defect structurally impossible.
--
-- Live security audit 2026-07-24 found the token columns holding the ASCII of a JSON-stringified
-- Uint8Array (`{"0":12,"1":255,…}`) instead of raw bytes: supabase-js JSON-encodes RPC arguments,
-- so a `Uint8Array` bytea param was serialized to text and cast verbatim. The AES-GCM output inside
-- was genuine, but `deserializeEnvelope` reads bytes 0..11 as the IV and got `{"0":123,"1`, so the
-- row could never be decrypted. The worst consequence was silent: `disconnect` swallows the decrypt
-- failure in a best-effort catch, so it deleted the local row and audited `m365.connection.revoked`
-- while the refresh token stayed LIVE at Microsoft (~90d) with our only copy destroyed.
--
-- The app-side fix is `toByteaParam`/`fromByteaValue` (crypto.ts). THIS migration is the backstop:
-- a mis-marshalled write must fail LOUD at the database instead of succeeding and rotting.
--
-- A valid envelope is `iv(12) || ciphertext || gcm_tag(16)`, so >= 28 bytes even for empty
-- plaintext. The mangled value was 14,709 bytes of printable ASCII starting with `{`; the length
-- floor alone would not have caught it, so we also reject a payload whose first byte is `{` (0x7b)
-- — no AES-GCM IV can be constrained that way, but every JSON-stringified object starts with it.
-- Cheap, exact, and it fails on the ACTUAL defect rather than a proxy for it.
--
-- Reversibility (ADR-0006): supabase db reset. Manual reverse:
--   alter table public.ms_graph_connections drop constraint ms_graph_connections_refresh_ct_envelope;
--   alter table public.ms_graph_connections drop constraint ms_graph_connections_access_ct_envelope;

alter table public.ms_graph_connections
  add constraint ms_graph_connections_refresh_ct_envelope
  check (
    refresh_token_ciphertext is null
    or (octet_length(refresh_token_ciphertext) >= 28
        and get_byte(refresh_token_ciphertext, 0) <> 123)
  );

alter table public.ms_graph_connections
  add constraint ms_graph_connections_access_ct_envelope
  check (
    access_token_ciphertext is null
    or (octet_length(access_token_ciphertext) >= 28
        and get_byte(access_token_ciphertext, 0) <> 123)
  );

comment on constraint ms_graph_connections_refresh_ct_envelope on public.ms_graph_connections is
  'HIGH-A1 (2026-07-24): reject a non-envelope ciphertext — >= iv(12)+tag(16) bytes, and never a JSON object (0x7b "{"), which is what a JSON-stringified Uint8Array serializes to.';
comment on constraint ms_graph_connections_access_ct_envelope on public.ms_graph_connections is
  'HIGH-A1 (2026-07-24): see ms_graph_connections_refresh_ct_envelope.';
