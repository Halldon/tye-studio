import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readMigrationPlan, trackedMigrationSql, validateMigrationState } from "../scripts/local-migration-plan.mjs";

function fixture(run: (root: string) => void) {
  const root = mkdtempSync(path.join(os.tmpdir(), "tye-migration-test-"));
  mkdirSync(path.join(root, "drizzle/meta"), { recursive: true });
  writeFileSync(path.join(root, "drizzle/meta/_journal.json"), JSON.stringify({ version: "7", dialect: "sqlite", entries: [{ idx: 0, version: "6", when: 1, tag: "0000_first", breakpoints: true }] }));
  writeFileSync(path.join(root, "drizzle/0000_first.sql"), "CREATE TABLE example (id TEXT);\n");
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("local migration plans follow the journal and reject unjournaled SQL", () => fixture((root) => {
  assert.equal(readMigrationPlan(root)[0].name, "0000_first.sql");
  writeFileSync(path.join(root, "drizzle/0001_unrecorded.sql"), "SELECT 1;");
  assert.throws(() => readMigrationPlan(root), /SQL files and Drizzle journal differ/);
}));

test("local migration plans reject duplicate, reordered and missing journal entries", () => fixture((root) => {
  const journal = path.join(root, "drizzle/meta/_journal.json");
  const data = JSON.parse(readFileSync(journal, "utf8"));
  data.entries[0].idx = 1;
  writeFileSync(journal, JSON.stringify(data));
  assert.throws(() => readMigrationPlan(root), /Invalid Drizzle migration journal/);
  data.entries[0].idx = 0; data.entries.push({ ...data.entries[0], idx: 1 });
  writeFileSync(journal, JSON.stringify(data));
  assert.throws(() => readMigrationPlan(root), /Invalid Drizzle migration journal/);
  data.entries = [{ ...data.entries[0], tag: "0000_missing" }];
  writeFileSync(journal, JSON.stringify(data));
  assert.throws(() => readMigrationPlan(root), /ENOENT/);
}));

test("verified migrations are not replayed and source drift is rejected", () => fixture((root) => {
  const plan = readMigrationPlan(root);
  const state = { tables: ["example", "d1_migrations", "tye_local_migration_checksums"], applied: [plan[0].name], checksums: [{ tag: plan[0].tag, sha256: plan[0].hash }] };
  assert.deepEqual(validateMigrationState(plan, state), []);
  writeFileSync(path.join(root, "drizzle/0000_first.sql"), "CREATE TABLE changed (id TEXT);\n");
  assert.throws(() => validateMigrationState(readMigrationPlan(root), state), /checksum differs/);
  assert.match(trackedMigrationSql(plan[0]), /INSERT INTO tye_local_migration_checksums/);
}));

test("setup refuses an existing untracked database instead of resetting or adopting it", () => fixture((root) => {
  const plan = readMigrationPlan(root);
  assert.throws(() => validateMigrationState(plan, { tables: ["studio_assets"], applied: [], checksums: [] }), /untracked schema/);
  assert.throws(() => validateMigrationState(plan, { tables: ["d1_migrations"], applied: [plan[0].name], checksums: [] }), /incomplete/);
  assert.deepEqual(validateMigrationState(plan, { tables: ["_cf_KV", "sqlite_sequence"], applied: [], checksums: [] }), plan);
}));
