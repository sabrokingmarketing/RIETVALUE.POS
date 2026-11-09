import { REASON_LABEL, type movementHistory } from "@/server/stock";
import { formatDateTime } from "@/lib/dates";
import { EmptyState, Table, td, th } from "@/components/ui";

export function MovementTable({ rows }: { rows: Awaited<ReturnType<typeof movementHistory>> }) {
  if (rows.length === 0) return <EmptyState title="No stock movements yet" />;
  return (
    <Table>
      <thead><tr><th className={th}>When</th><th className={th}>Item</th><th className={th}>Reason</th><th className={`${th} text-right`}>Change</th><th className={`${th} text-right`}>Balance</th><th className={th}>By</th><th className={th}>Reference</th></tr></thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m.id}>
            <td className={`${td} whitespace-nowrap`}>{formatDateTime(m.occurred_at)}</td>
            <td className={td}>{m.common_name} <span className="text-xs text-muted">{m.size_label}</span></td>
            <td className={td}>{REASON_LABEL[m.reason]}{m.note && <span className="block text-xs text-muted">{m.note}</span>}</td>
            <td className={`${td} tabular text-right font-semibold ${m.quantity < 0 ? "text-ink" : "text-forest"}`}>{m.quantity > 0 ? "+" : ""}{m.quantity}</td>
            <td className={`${td} tabular text-right`}>{m.balance_after}</td>
            <td className={td}>{m.operator_name}</td>
            <td className={`${td} font-mono text-xs`}>{m.source_ref}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
