-- #2286 bench guard: refuse, before any write, unless the connection is to a local database. The server address is null
-- (unix socket) or loopback, or psql connected to a loopback host or socket (the local Supabase stack runs in Docker, so
-- through its published port the server sees its container address, while psql's own HOST is still loopback).
\set ON_ERROR_STOP on
select (inet_server_addr() is null or host(inet_server_addr()) in ('127.0.0.1','::1')
  or :'HOST' in ('localhost','127.0.0.1','::1') or left(:'HOST',1) = '/') as bench_local \gset
\if :bench_local
\else
\echo '2286 bench: refusing to run against a database that is not local'
select 1 / 0 as refused_non_local_database;
\endif
