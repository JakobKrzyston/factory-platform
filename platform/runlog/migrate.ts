/** Applies the run log migrations to Postgres when DATABASE_URL is set, otherwise to SQLite in .runlog/.
 *  Exports migrateSqlite and migratePostgres. Run: pnpm runlog:migrate */
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

import postgres from "postgres";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");
const DEFAULT_SQLITE_PATH = ".runlog/runlog.db";
const TRACKING_TABLE = "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY)";

type Migration = { version: string; sql: string };

function migrations(): Migration[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ version: f.replace(/\.sql$/, ""), sql: readFileSync(join(MIGRATIONS_DIR, f), "utf8") }));
}

/** Applies pending migrations to a SQLite file, each in its own transaction.
 *  Args: path: the database file; its directory is created if missing.
 *  Returns: the versions applied by this call, empty when already up to date. */
export function migrateSqlite(path: string): string[] {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec(TRACKING_TABLE);
    const done = new Set(db.prepare("SELECT version FROM schema_migrations").all().map((r) => r.version));
    const applied: string[] = [];
    for (const m of migrations().filter((m) => !done.has(m.version))) {
      db.exec("BEGIN");
      try {
        db.exec(m.sql);
        db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(m.version);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      applied.push(m.version);
    }
    return applied;
  } finally {
    db.close();
  }
}

/** Applies pending migrations to a Postgres database, each in its own transaction.
 *  Args: url: a Postgres connection string, such as a Neon branch's.
 *  Returns: the versions applied by this call, empty when already up to date. */
export async function migratePostgres(url: string): Promise<string[]> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(TRACKING_TABLE);
    const done = new Set((await sql`SELECT version FROM schema_migrations`).map((r) => r.version));
    const applied: string[] = [];
    for (const m of migrations().filter((m) => !done.has(m.version))) {
      await sql.begin(async (tx) => {
        await tx.unsafe(m.sql);
        await tx`INSERT INTO schema_migrations (version) VALUES (${m.version})`;
      });
      applied.push(m.version);
    }
    return applied;
  } finally {
    await sql.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  const applied = url ? await migratePostgres(url) : migrateSqlite(DEFAULT_SQLITE_PATH);
  const target = url ? "Postgres (DATABASE_URL)" : DEFAULT_SQLITE_PATH;
  console.log(applied.length ? `Applied ${applied.join(", ")} to ${target}` : `${target} is up to date`);
}
