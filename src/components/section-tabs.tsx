import { Tabs } from "@/components/ui";

const SETS = {
  inventory: [["/admin/stock", "Stock levels"], ["/admin/receive", "Receive stock"]],
  sales: [["/till/receipts", "Receipts & returns"], ["/till/cash", "Till & cash-up"]],
  settings: [["/admin/settings", "Business & VAT"], ["/admin/staff", "Staff"], ["/admin/labels/presets", "Label sizes"]],
} as const;

export function SectionTabs({ set, active }: { set: keyof typeof SETS; active: string }) {
  return <Tabs items={SETS[set].map(([href, label]) => ({ href, label, active: href === active }))} />;
}
