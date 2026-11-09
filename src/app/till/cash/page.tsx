import type { Metadata } from "next";
import { pageActor } from "@/server/session";
import { cashSummary, currentTill } from "@/server/till";
import { formatDateTime } from "@/lib/dates";
import { formatRand } from "@/lib/money";
import { Card, PageHeader } from "@/components/ui";
import { OpenTillForm, CloseTillForm, TillResult } from "./forms";
import { q1 } from "@/server/db";

export const metadata: Metadata = { title: "Cash up" };

export default async function CashPage({ searchParams }: { searchParams: Promise<{ closed?: string }> }) {
  const actor = await pageActor(["owner", "cashier"], "/till/cash");
  const closedId = Number((await searchParams).closed) || 0;
  const closed = closedId ? await q1<{ expected_cash_cents: number; counted_cash_cents: number; variance_cents: number }>(
    `SELECT expected_cash_cents, counted_cash_cents, variance_cents FROM till_sessions WHERE id = $1 AND closed_at IS NOT NULL`, [closedId]) : undefined;
  const till = await currentTill();
  const summary = till ? await cashSummary(till.id) : null;
  return (
    <div className="mx-auto w-full max-w-2xl p-4">
      <PageHeader title={till ? "Close the till" : closed ? "Till closed" : "Open the till"}
        description={till ? `Opened ${formatDateTime(till.opened_at)} by ${till.opened_by_name} with a float of ${formatRand(till.opening_float_cents)}.`
          : "Count the notes and coins in the drawer before the first sale."} />
      {closed && !till && <TillResult expectedCents={closed.expected_cash_cents} countedCents={closed.counted_cash_cents} varianceCents={closed.variance_cents} />}
      {till && summary ? (
        <Card className="p-5">
          <p className="text-sm text-muted">{summary.sales} sale{summary.sales === 1 ? "" : "s"} and {summary.returns} return{summary.returns === 1 ? "" : "s"} on this till.
            Count all cash in the drawer (including the float) and enter the total. You will see the expected amount after you submit.</p>
          {actor.role === "owner" && <p className="mt-2 text-sm text-muted">Owner view — expected cash right now: <strong className="tabular">{formatRand(summary.expected)}</strong></p>}
          <CloseTillForm />
        </Card>
      ) : (
        <Card className="p-5"><OpenTillForm /></Card>
      )}
    </div>
  );
}
