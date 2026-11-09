/**
 * Versioned SQL migrations. Applies migrations/NNNN_name.sql in order, each in its own
 * transaction, and records them in schema_migrations with a checksum. Applied files must
 * never be edited — add a new migration instead (the runner refuses a changed checksum).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";

export async function migrate(connectionString: string, log = console.log) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    await client.query(`SELECT pg_advisory_lock(727274)`);
    const dir = path.join(process.cwd(), "migrations");
    const files = fs.readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    const applied = new Map((await client.query(`SELECT version, checksum FROM schema_migrations`)).rows.map((r) => [r.version, r.checksum]));
    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      const sum = crypto.createHash("sha256").update(sql).digest("hex");
      if (applied.has(file)) {
        if (applied.get(file) !== sum) throw new Error(`Migration ${file} was changed after it was applied. Create a new migration instead.`);
        continue;
      }
      log(`Applying ${file}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)`, [file, sum]);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
      }
    }
    log("Database is up to date.");
  } finally {
    await client.query(`SELECT pg_advisory_unlock(727274)`).catch(() => {});
    await client.end();
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
  migrate(url).catch((e) => { console.error(e.message); process.exit(1); });
}
