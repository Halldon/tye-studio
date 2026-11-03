import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const checksumTable = "tye_local_migration_checksums";

// The journal is the source of truth. Never infer migration order from directory
// iteration or silently skip an SQL file that Drizzle has not recorded.
export function readMigrationPlan(projectRoot) {
  const directory = path.join(projectRoot, "drizzle");
  const journal = JSON.parse(readFileSync(path.join(directory, "meta/_journal.json"), "utf8"));
  if (journal.dialect !== "sqlite" || !/^\d+$/.test(journal.version) || !Array.isArray(journal.entries) || !journal.entries.length) {
    throw new Error("Expected a nonempty SQLite Drizzle migration journal.");
  }
  const seen = new Set();
  let previousTime = -1;
  const migrations = journal.entries.map((entry, index) => {
    if (entry.idx !== index || !/^\d{4}_[a-z0-9_]+$/.test(entry.tag) || seen.has(entry.tag) || !Number.isSafeInteger(entry.when) || entry.when <= previousTime) {
      throw new Error(`Invalid Drizzle migration journal entry at index ${index}.`);
    }
    seen.add(entry.tag);
    previousTime = entry.when;
    const name = `${entry.tag}.sql`;
    const sql = readFileSync(path.join(directory, name), "utf8");
    if (!sql.trim()) throw new Error(`Migration ${name} is empty.`);
    return { name, tag: entry.tag, sql, hash: createHash("sha256").update(sql).digest("hex") };
  });
  const sqlFiles = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort();
  if (JSON.stringify(sqlFiles) !== JSON.stringify(migrations.map(({ name }) => name).sort())) {
    throw new Error("SQL files and Drizzle journal differ. Generate and commit a complete migration before continuing.");
  }
  return migrations;
}

export function validateMigrationState(migrations, { tables, applied, checksums }) {
  const allowedTables = new Set(["d1_migrations", checksumTable]);
  const userTables = tables.filter((name) => !name.startsWith("sqlite_") && !name.startsWith("_cf_") && !allowedTables.has(name));
  if (!applied.length && (userTables.length || checksums.length)) {
    throw new Error("This local database already has an untracked schema. No SQL was applied. Back it up and migrate it explicitly; setup never resets or adopts an existing database.");
  }
  if (applied.length > migrations.length || checksums.length !== applied.length) {
    throw new Error("Local migration history is incomplete or belongs to another migration set. No SQL was applied.");
  }
  for (let index = 0; index < applied.length; index++) {
    const migration = migrations[index];
    const recorded = checksums.find((value) => value.tag === migration.tag);
    if (applied[index] !== migration.name || !recorded || recorded.sha256 !== migration.hash) {
      throw new Error(`Local migration history or checksum differs at ${migration.name}. Restore the original migration and add a new migration instead of replaying SQL.`);
    }
  }
  return migrations.slice(applied.length);
}

export function trackedMigrationSql(migration) {
  // Tags and hashes are validated above; source SQL is kept byte-for-byte and
  // the checksum is committed in the same transaction as the D1 migration.
  return `${migration.sql}\n;\nCREATE TABLE IF NOT EXISTS ${checksumTable} (tag TEXT PRIMARY KEY NOT NULL, sha256 TEXT NOT NULL);\nINSERT INTO ${checksumTable} (tag, sha256) VALUES ('${migration.tag}', '${migration.hash}');\n`;
}
