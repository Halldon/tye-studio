import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "./sites-env.mjs";
import { checksumTable, readMigrationPlan, trackedMigrationSql, validateMigrationState } from "./local-migration-plan.mjs";

if (process.argv.length > 2) throw new Error("Usage: npm run db:migrate:local (local database only; no arguments)");

const runtimeRoot = path.join(projectRoot, ".sites-runtime");
const lockPath = path.join(runtimeRoot, "local-migrations.lock");
const configPath = path.join(runtimeRoot, "local-migrations.json");
const migrationsPath = path.join(runtimeRoot, "local-migrations");
const buildConfigPath = path.join(projectRoot, "dist/server/wrangler.json");
const wrangler = path.join(projectRoot, "node_modules/wrangler/bin/wrangler.js");
if (!existsSync(buildConfigPath) || !existsSync(wrangler)) throw new Error("Run npm run build after installing dependencies, then retry this local migration command.");
const migrations = readMigrationPlan(projectRoot);
const buildConfig = JSON.parse(readFileSync(buildConfigPath, "utf8"));
const database = buildConfig.d1_databases?.find((value) => value.binding === "DB");
if (!database?.database_id || !database.database_name) throw new Error("The build does not declare the DB D1 binding. Check .openai/hosting.json and rebuild.");

mkdirSync(runtimeRoot, { recursive: true });
try {
  mkdirSync(lockPath);
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  throw new Error("A local migration is already running. If its process stopped, remove .sites-runtime/local-migrations.lock and retry. The database was not changed.");
}

try {
  // A minimal local-only config uses the same database ID and persistence path
  // as Vite and npm start. It needs no account, login, project ID or credentials.
  writeFileSync(configPath, JSON.stringify({
    name: "tye-local-migrations",
    compatibility_date: buildConfig.compatibility_date,
    d1_databases: [{ ...database, migrations_dir: migrationsPath, migrations_table: "d1_migrations" }],
  }, null, 2));

  function wranglerArgs(action, extra) {
    return [wrangler, "d1", action, "DB", "--local", "--config", configPath, "--persist-to", path.join(projectRoot, ".wrangler/state"), ...extra];
  }
  function query(sql) {
    const result = spawnSync(process.execPath, wranglerArgs("execute", ["--command", sql, "--json"]), { cwd: projectRoot, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Local D1 query failed: ${result.stderr || result.stdout}`);
    const responses = JSON.parse(result.stdout);
    if (!Array.isArray(responses) || responses.some((response) => !response.success)) throw new Error("Local D1 query did not complete successfully.");
    return responses.flatMap((response) => response.results || []);
  }
  function state() {
    const tables = query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((row) => row.name);
    return {
      tables,
      applied: tables.includes("d1_migrations") ? query("SELECT name FROM d1_migrations ORDER BY id").map((row) => row.name) : [],
      checksums: tables.includes(checksumTable) ? query(`SELECT tag, sha256 FROM ${checksumTable}`) : [],
    };
  }

  const pending = validateMigrationState(migrations, state());
  if (!pending.length) {
    console.log(`Local database is up to date (${migrations.length} migrations verified).`);
  } else {
    mkdirSync(migrationsPath, { recursive: true });
    for (const filename of readdirSync(migrationsPath)) {
      if (filename.endsWith(".sql")) rmSync(path.join(migrationsPath, filename));
    }
    for (const migration of migrations) writeFileSync(path.join(migrationsPath, migration.name), trackedMigrationSql(migration));
    const applied = spawnSync(process.execPath, [wrangler, "d1", "migrations", "apply", "DB", "--local", "--config", configPath, "--persist-to", path.join(projectRoot, ".wrangler/state")], { cwd: projectRoot, stdio: ["pipe", "inherit", "inherit"], input: "y\n" });
    if (applied.error) throw applied.error;
    if (applied.status !== 0) throw new Error("Local migration failed. Earlier successful migrations remain recorded; inspect the error and retry after fixing its cause.");
    if (validateMigrationState(migrations, state()).length) throw new Error("Some local migrations are still pending.");
    console.log(`Applied ${pending.length} local migration(s); ${migrations.length} source checksums verified.`);
  }
} finally {
  rmSync(lockPath, { recursive: true, force: true });
}
