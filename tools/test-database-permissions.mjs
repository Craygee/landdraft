import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const root = resolve(process.argv[2] ?? ".");
const { PGlite } = await import(
  pathToFileURL(
    resolve(
      process.env.LANDDRAFT_PGLITE_MODULE ??
        ".task-db-verify/node_modules/@electric-sql/pglite/dist/index.js",
    ),
  ).href
);
const expected = JSON.parse(
  await readFile(resolve(root, "tools/database-permissions.json"), "utf8"),
);
const files = (await readdir(resolve(root, "supabase/migrations")))
  .filter((x) => x.endsWith(".sql"))
  .sort();
let checks = 0;
for (const legacy of [false, true]) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create schema storage; create schema extensions;
 grant usage on schema public,auth,storage to anon,authenticated,service_role;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,banned_until timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create function auth.role() returns text language sql stable as $$ select current_user::text $$;
 create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid,metadata jsonb);
 alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
 create function extensions.gen_random_uuid() returns uuid language sql volatile as $$ select gen_random_uuid() $$;
 create function extensions.gen_random_bytes(integer) returns bytea language sql volatile as $$ select decode(repeat('ab',$1),'hex') $$;`);
  if (legacy)
    await db.exec(
      "alter default privileges in schema public grant all on tables to anon,authenticated,service_role; alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;",
    );
  for (const name of files) {
    let sql = await readFile(resolve(root, "supabase/migrations", name), "utf8");
    // Extension installation belongs to Supabase; no PostGIS operations are used in these migrations.
    sql = sql.replace(/^create extension[^;]+;/gm, "");
    try {
      // On fresh databases verify table-creating migrations themselves, not only the final repair.
      await db.exec(sql);
      if (!legacy)
        for (const match of sql.matchAll(/create table(?: if not exists)? public\.(\w+)/g)) {
          const table = match[1],
            entry = expected[table];
          assert.ok(entry, `Unclassified new table: ${table}`);
          for (const role of ["anon", "authenticated", "service_role"]) {
            for (const privilege of entry[role]) {
              const { rows } = await db.query("select has_table_privilege($1,$2,$3) as allowed", [
                role,
                "public." + table,
                privilege,
              ]);
              assert.equal(
                rows[0].allowed,
                true,
                `${name}: explicit ${role} ${privilege} missing on ${table}`,
              );
              checks++;
            }
          }
        }
    } catch (e) {
      throw new Error(`${legacy ? "legacy" : "explicit"} ${name}: ${e.message}`);
    }
  }
  // Repair migration must be safe to reapply without changing policies or data.
  await db.exec(
    await readFile(
      resolve(root, "supabase/migrations/202610200001_explicit_data_api_grants.sql"),
      "utf8",
    ),
  );
  const { rows: tables } = await db.query(
    "select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'",
  );
  for (const table of tables) {
    const entry = expected[table.relname];
    assert.ok(entry, `Unclassified public table: ${table.relname}`);
    checks++;
    assert.equal(table.relrowsecurity, true, `RLS missing: ${table.relname}`);
    checks++;
    for (const role of ["anon", "authenticated", "service_role"]) {
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        if (entry.rpcOnly && role === "service_role") continue;
        const { rows } = await db.query("select has_table_privilege($1,$2,$3) as allowed", [
          role,
          "public." + table.relname,
          privilege,
        ]);
        const wanted = entry[role].includes(privilege);
        // Old defaults can leave unused authenticated privileges, protected by RLS.
        // Assert required permissions, and exact denials for anonymous/server-only/RPC-only tables.
        if (
          !legacy ||
          wanted ||
          role === "anon" ||
          entry.rpcOnly ||
          entry.authenticated.length === 0
        ) {
          assert.equal(rows[0].allowed, wanted, `${table.relname} ${role} ${privilege}`);
          checks++;
        }
      }
    }
  }
  // Synthetic users only. Exercise actual RLS and security-definer functions.
  const a = "10000000-0000-0000-0000-000000000001",
    b = "10000000-0000-0000-0000-000000000002";
  await db.exec(`insert into auth.users(id,email) values('${a}','a@example.test'),('${b}','b@example.test');
 insert into public.projects(owner_id,name,state_path) values('${a}','A','a/map'),('${b}','B','b/map');`);
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${a}';`);
  assert.equal((await db.query("select name from public.projects")).rows.length, 1);
  checks++;
  assert.equal(
    (await db.query("update public.projects set name='forbidden' where name='B' returning id")).rows
      .length,
    0,
  );
  checks++;
  await db.exec("select public.upsert_weather_chaser_presence('Test',30,-100,null,null,null)");
  checks++;
  assert.equal(
    (await db.query("select * from public.list_active_weather_chasers(30,-100,10)")).rows.length,
    1,
  );
  checks++;
  await assert.rejects(
    db.query("select * from public.weather_chaser_presence"),
    /permission denied/,
  );
  checks++;
  await db.exec("reset role; set role anon");
  await assert.rejects(db.query("select * from public.projects"), /permission denied/);
  checks++;
  await db.query("select * from public.weather_provider_catalog");
  checks++;
  await assert.rejects(db.query("select * from public.ai_daily_usage"), /permission denied/);
  checks++;
  await db.exec("reset role; set role service_role");
  await db.query("select * from public.projects");
  checks++;
  await db.exec("reset role");
  const audit = await db.exec(
    await readFile(resolve(root, "supabase/tests/data_api_permissions.sql"), "utf8"),
  );
  assert.ok(
    audit[0].rows.every((row) => row.status === "OK" || row.status === "OPTIONAL NOT INSTALLED"),
  );
  checks++;
  // Production currently has no governance/cache tables. Repair must also work
  // on this smaller installation without creating any optional features.
  await db.exec(
    "drop table if exists public.weather_provider_audit_events, public.weather_product_entitlements, public.weather_license_reviews, public.weather_product_catalog, public.weather_provider_catalog cascade;",
  );
  await db.exec(
    await readFile(
      resolve(root, "supabase/migrations/202610200001_explicit_data_api_grants.sql"),
      "utf8",
    ),
  );
  checks++;
  await db.close();
  console.log(
    `${legacy ? "Legacy automatic grants" : "No automatic grants"}: migrations, grant matrix, RLS and presence RPC checks passed`,
  );
}
console.log(`${checks} database assertions passed`);
