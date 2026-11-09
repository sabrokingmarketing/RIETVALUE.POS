/**
 * Controlled removal of development fixtures before going live.
 *   npm run purge:demo                       → dry run: shows exactly what would be removed
 *   npm run purge:demo -- --confirm          → removes demo accounts and their test transactions
 *   npm run purge:demo -- --confirm --catalogue  → also removes the placeholder (fixture) catalogue
 * Take a backup first (scripts/backup.sh). Refuses if any real staff sale exists.
 */
import { getPool } from "../src/server/db";
import { executePurge, planPurge } from "../src/server/maintenance";

async function main() {
  const confirm = process.argv.includes("--confirm");
  const catalogue = process.argv.includes("--catalogue");
  const plan = await planPurge(catalogue);
  console.log("Demo accounts:", plan.demoUsers.join(", ") || "none");
  console.log(`Demo sales ${plan.demoSales}, returns ${plan.returns}, stock movements ${plan.movements}, deliveries ${plan.deliveries}, till sessions ${plan.tills}, label jobs ${plan.labelJobs}, imports ${plan.importJobs}${catalogue ? `, fixture products ${plan.fixtureProducts}` : ""}`);
  if (plan.blocked) { console.error("BLOCKED:", plan.blocked); process.exitCode = 1; return; }
  if (!confirm) { console.log("Dry run only. Re-run with --confirm to remove these."); return; }
  await executePurge(catalogue);
  console.log("Done. Demo data removed and recorded in the audit log.");
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => getPool().end());
