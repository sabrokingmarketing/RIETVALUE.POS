"use server";
import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/session";
import { runAction, type ActionState } from "@/server/http";
import {
  deleteDraft, duplicateInvoice, issueInvoice, markPaid, markUnpaid, saveManualInvoice, voidInvoice, type ManualInvoiceInput,
} from "@/server/invoices";
import { sendInvoiceEmail, type EmailResult } from "@/server/invoice-mail";
import { clearLogo, setLogo, updateInvoiceSettings } from "@/server/settings";

const refresh = (id?: string) => { revalidatePath("/admin/invoices"); if (id) revalidatePath(`/admin/invoices/${id}`); };

/** Save a manual invoice. mode "draft" keeps it editable; "issue" numbers and locks it; "send" also e-mails it. */
export async function saveInvoiceAction(id: string | null, input: ManualInvoiceInput, mode: "draft" | "issue" | "send"):
  Promise<ActionState<{ id: string; invoiceNo: string | null; email?: EmailResult }>> {
  return runAction(async () => {
    const actor = await requireActor(["owner"]);
    const r = await saveManualInvoice(actor, id, input, { issue: mode !== "draft" });
    let email: EmailResult | undefined;
    if (mode === "send" && input.billTo.email) email = await sendInvoiceEmail(actor, r.id, { to: input.billTo.email });
    refresh(r.id);
    return { ...r, email };
  });
}

export async function issueInvoiceAction(id: string): Promise<ActionState<string>> {
  return runAction(async () => { const no = await issueInvoice(await requireActor(["owner"]), id); refresh(id); return no; }, "Invoice issued.");
}
export async function emailInvoiceAction(id: string, to: string, message: string): Promise<ActionState<EmailResult>> {
  return runAction(async () => { const r = await sendInvoiceEmail(await requireActor(["owner", "cashier"]), id, { to, message }); refresh(id); return r; });
}
export async function markPaidAction(id: string, input: { method: string; date: string; reference: string }): Promise<ActionState> {
  return runAction(async () => { await markPaid(await requireActor(["owner"]), id, input as never); refresh(id); }, "Marked as paid.");
}
export async function markUnpaidAction(id: string): Promise<ActionState> {
  return runAction(async () => { await markUnpaid(await requireActor(["owner"]), id); refresh(id); }, "Set back to awaiting payment.");
}
export async function voidInvoiceAction(id: string, reason: string): Promise<ActionState> {
  return runAction(async () => { await voidInvoice(await requireActor(["owner"]), id, reason); refresh(id); }, "Invoice voided.");
}
export async function deleteDraftAction(id: string): Promise<ActionState> {
  return runAction(async () => { await deleteDraft(await requireActor(["owner"]), id); refresh(); }, "Draft deleted.");
}
export async function duplicateInvoiceAction(id: string): Promise<ActionState<string>> {
  return runAction(async () => { const n = await duplicateInvoice(await requireActor(["owner"]), id); refresh(); return n; });
}

export async function invoiceSettingsAction(_: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    await updateInvoiceSettings(await requireActor(["owner"]), {
      paymentInfo: String(f.get("paymentInfo") ?? ""), termsDays: String(f.get("termsDays") ?? "7") as never, thanks: String(f.get("thanks") ?? ""),
    });
    revalidatePath("/admin/settings/invoices");
  }, "Invoice settings saved.");
}
export async function uploadLogoAction(_: ActionState, f: FormData): Promise<ActionState<string>> {
  return runAction(async () => {
    const name = await setLogo(await requireActor(["owner"]), f.get("logo") as File | null);
    revalidatePath("/admin", "layout");
    return name;
  }, "Logo uploaded.");
}
export async function clearLogoAction(): Promise<ActionState> {
  return runAction(async () => { await clearLogo(await requireActor(["owner"])); revalidatePath("/admin", "layout"); }, "Using the built-in logo.");
}
