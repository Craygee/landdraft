import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
const require = createRequire(join(process.env.TEMP, "landdraft-access-sql-test", "package.json"));
const { PGlite } = require("@electric-sql/pglite");
const db = new PGlite();
const ids = {
  owner: "00000000-0000-4000-8000-000000000001",
  john: "00000000-0000-4000-8000-000000000002",
  user: "00000000-0000-4000-8000-000000000003",
  new: "00000000-0000-4000-8000-000000000004",
};
const actor = "65143427-087f-586b-b437-05389750d0e7";
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin;
create schema auth; create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,banned_until timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table public.projects(id int primary key, title text); alter table public.projects enable row level security;
create table public.weather_chaser_presence(id int); alter table public.weather_chaser_presence enable row level security;
create policy weather_existing on public.weather_chaser_presence to authenticated using(true);
grant select on public.weather_chaser_presence to authenticated;
insert into public.weather_chaser_presence values(1);
create policy existing_policy on public.projects for all to authenticated using(true) with check(true);
grant usage on schema auth,storage to anon,authenticated;
grant select on public.projects to authenticated;
insert into public.projects values(1,'Preserve this project');
create table storage.objects(id uuid); alter table storage.objects enable row level security;
create policy existing_storage on storage.objects for all to authenticated using(true);
grant select on storage.objects to authenticated;
insert into auth.users values('${ids.owner}','dev@glab.co',now(),null),('${ids.john}','jsgrella@gmail.com',now(),null),('${ids.user}','fictional@example.test',now(),null);`);
await db.exec(readFileSync("supabase/migrations/202609140001_site_access.sql", "utf8"));
await db.exec(readFileSync("supabase/migrations/202609140002_module_access.sql", "utf8"));
await db.exec(readFileSync("supabase/migrations/202609140003_service_access.sql", "utf8"));
await db.exec(readFileSync("tools/site-access-test-signup-hook.sql", "utf8"));
async function hook(email) {
  return (
    await db.query("select public.hook_landdraft_test_signup($1) as result", [
      JSON.stringify({ user: { email } }),
    ])
  ).rows[0].result;
}
assert.equal((await hook("nobody@example.test")).error.http_code, 403);
async function allowed(uid, module = null) {
  return (await db.query("select landdraft_control.allowed($1,$2) as ok", [uid, module])).rows[0]
    .ok;
}
async function admin(action, fields, op = crypto.randomUUID()) {
  return db.query("select public.landdraft_control_admin($1,$2,$3)", [
    action,
    JSON.stringify({ ...fields, reason: "Automated policy test", operationId: op }),
    actor,
  ]);
}
assert.equal(await allowed(ids.user, "weather.core"), true, "Installation must preserve access");
await assert.rejects(admin("account", { userId: ids.user, lockedOut: true }), /not activated/);
await db.exec(readFileSync("tools/site-access-activate.sql", "utf8"));
assert.equal(await allowed(ids.user, "weather.core"), true);
await assert.rejects(admin("account", { userId: ids.owner, lockedOut: true }), /Protected owner/);
await assert.rejects(
  db.exec(`insert into landdraft_control.accounts values('${ids.owner}',true)`),
  /Protected owner/,
);
await admin("account", { userId: ids.user, lockedOut: true });
assert.equal(await allowed(ids.user), false, "Existing session immediately blocked");
assert.equal(
  (await db.query("select public.landdraft_service_access($1) as ok", [ids.user])).rows[0].ok,
  false,
  "Inbound integration blocks locked recipients",
);
await db.exec(
  `set role authenticated; select set_config('request.jwt.claim.sub','${ids.user}',false);`,
);
assert.equal(
  (await db.query("select * from public.projects")).rows.length,
  0,
  "RLS restricts existing data",
);
await db.exec("reset role");
await admin("account", { userId: ids.user, lockedOut: false });
await admin("complimentary", { userId: ids.user, moduleId: "weather.core", enabled: false });
assert.equal(await allowed(ids.user, "weather.core"), false);
await db.exec(readFileSync("tools/site-access-activate.sql", "utf8"));
assert.equal(
  await allowed(ids.user, "weather.core"),
  false,
  "Activation retry must not restore revoked grants",
);
await db.exec(
  `set role authenticated; select set_config('request.jwt.claim.sub','${ids.user}',false);`,
);
assert.equal(
  (await db.query("select * from public.weather_chaser_presence")).rows.length,
  0,
  "Direct weather table access must enforce module grants",
);
assert.equal(
  (await db.query("select * from public.projects")).rows.length,
  1,
  "Weather revocation preserves mapping data access",
);
await db.exec("reset role");
assert.equal(await allowed(ids.user, "pipeline.core"), true);
assert.equal(await allowed(ids.user, "mapping.core"), true);
await admin("settings", { fullyLockedDown: true });
assert.equal((await hook("nobody@example.test")).error.http_code, 403);
assert.equal(await allowed(ids.owner, "weather.core"), true);
assert.equal(await allowed(ids.john, "weather.core"), true);
assert.equal(await allowed(ids.user), false);
await assert.rejects(
  db.exec(`insert into auth.users values('${ids.new}','new@example.test',now(),null)`),
  /restricted/,
);
await admin("settings", { fullyLockedDown: false, allowNewAccounts: false });
await assert.rejects(
  db.exec(`insert into auth.users values('${ids.new}','new@example.test',now(),null)`),
  /restricted/,
);
const op = crypto.randomUUID();
await admin("invitations", { email: "new@example.test", modules: ["water.hydrogeology"] }, op);
assert.deepEqual(await hook("new@example.test"), {});
await admin("invitations", { email: "new@example.test", modules: ["water.hydrogeology"] }, op);
await assert.rejects(
  admin("invitations", { email: "other@example.test", modules: [] }, op),
  /Operation conflict/,
);
await db.exec(`insert into auth.users values('${ids.new}','new@example.test',null,null)`);
assert.equal(
  await allowed(ids.new, "water.hydrogeology"),
  false,
  "Unverified invite cannot grant access",
);
await db.exec(`update auth.users set email_confirmed_at=now() where id='${ids.new}'`);
assert.equal(await allowed(ids.new, "water.hydrogeology"), true);
assert.equal(await allowed(ids.new, "pipeline.core"), false);
await assert.rejects(
  db.query("select public.landdraft_control_admin($1,$2,$3)", ["state", "{}", "spoofed"]),
  /Owner required/,
);
await db.exec("set role authenticated");
await assert.rejects(
  db.query("select public.landdraft_service_access($1)", [ids.owner]),
  /permission denied/,
);
await assert.rejects(
  db.query("select public.landdraft_control_admin($1,$2,$3)", ["state", "{}", actor]),
  /permission denied/,
);
await db.exec("reset role");
await assert.rejects(db.exec("delete from landdraft_control.audit"), /Append-only/);
assert.equal(
  (await db.query("select title from public.projects")).rows[0].title,
  "Preserve this project",
);
console.log(
  "PASS: install preservation, owner protection, existing-session/RLS lockout, module independence, lockdown, signup, verified invitations, idempotency, service-role boundary, audit and data preservation.",
);
const catalog = (
  await db.query(
    `select 'column' as kind,n.nspname as schema_name,c.relname as object_name,a.attname as detail,format_type(a.atttypid,a.atttypmod) as extra from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='landdraft_control' and c.relkind='r' and a.attnum>0 and not a.attisdropped order by 2,3,4`,
  )
).rows;
mkdirSync(".release/access-review", { recursive: true });
writeFileSync(".release/access-review/control-catalog.json", JSON.stringify(catalog, null, 2));
await db.close();
