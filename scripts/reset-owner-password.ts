/**
 * Server-side owner password reset (when e-mail is not configured or the owner is locked out).
 *   npm run owner:reset-password -- owner@example.co.za
 * Prompts for the new password without echoing it, and signs the owner out everywhere.
 */
import readline from "node:readline";
import { getPool, q1 } from "../src/server/db";
import { setStaffPassword } from "../src/server/users";

async function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  let muted = false;
  out._writeToOutput = (s: string) => { if (!muted) out.output.write(s); };
  return new Promise((resolve) => {
    rl.question(prompt, (a) => { rl.close(); process.stdout.write("\n"); resolve(a); });
    muted = true;
  });
}

async function main() {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  if (!email) throw new Error("Usage: npm run owner:reset-password -- owner@example.co.za");
  const u = await q1<{ id: string; role: string }>(`SELECT id, role FROM "user" WHERE lower(email) = $1`, [email]);
  if (!u) throw new Error(`No staff account with e-mail ${email}`);
  const pw = await ask("New password (min 10 characters): ");
  const again = await ask("Type it again: ");
  if (pw !== again) throw new Error("Passwords do not match");
  await setStaffPassword(null, u.id, pw);
  await q1(`UPDATE "user" SET active = true WHERE id = $1`, [u.id]);
  console.log(`Password changed for ${email} (${u.role}). All their sessions were signed out.`);
}

main().then(() => getPool().end()).catch(async (e) => { console.error(e.message); await getPool().end(); process.exit(1); });
