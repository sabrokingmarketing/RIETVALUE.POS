import type { Metadata } from "next";
import { pageActor } from "@/server/session";
import { listStaff } from "@/server/users";
import { formatDateTime } from "@/lib/dates";
import { Badge, Card, PageHeader } from "@/components/ui";
import { AddStaffForm, StaffActions } from "./forms";

export const metadata: Metadata = { title: "Staff" };

export default async function StaffPage() {
  const actor = await pageActor(["owner"], "/admin/staff");
  const staff = await listStaff(actor);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Staff" description="Cashiers can sell, look up and reprint receipts, cash up and print labels. Only owners change prices, receive stock, adjust stock and authorise returns." />
      <ul className="flex flex-col gap-3">
        {staff.map((s) => (
          <li key={s.id}>
            <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">{s.name} {s.id === actor.id && <span className="text-sm font-normal text-muted">(you)</span>}</p>
                <p className="text-sm text-muted">{s.email} · last active {s.last_seen ? formatDateTime(s.last_seen) : "never"}</p>
                <div className="mt-1 flex gap-1"><Badge tone={s.role === "owner" ? "green" : "neutral"}>{s.role === "owner" ? "Owner" : "Cashier"}</Badge>{!s.active && <Badge tone="danger">Deactivated</Badge>}</div>
              </div>
              {s.id !== actor.id && <StaffActions userId={s.id} name={s.name} active={s.active} />}
            </Card>
          </li>
        ))}
      </ul>
      <Card className="mt-8 p-5"><h2 className="mb-4 font-semibold">Add a staff member</h2><AddStaffForm /></Card>
    </div>
  );
}
