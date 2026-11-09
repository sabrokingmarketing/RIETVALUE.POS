"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/session";
import { runAction, type ActionState } from "@/server/http";
import { openTill, closeTill } from "@/server/till";
import { processReturn, type ReturnInput } from "@/server/returns";
import { parseRandToCents } from "@/lib/money";
import { AppError } from "@/server/errors";
import { acknowledgeRelabel } from "@/server/catalog";

function rand(form: FormData, name: string, label: string): number {
  const v = parseRandToCents(String(form.get(name) ?? ""));
  if (v === null) throw new AppError("VALIDATION", `Enter ${label} in rand, e.g. 500.00`);
  return v;
}

export async function openTillAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor(["owner", "cashier"]);
    await openTill(actor, { floatCents: rand(form, "float", "the opening float") });
    revalidatePath("/till", "layout");
    redirect("/till");
  }, "Till opened.");
}

export async function closeTillAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor(["owner", "cashier"]);
    const r = await closeTill(actor, { countedCents: rand(form, "counted", "the counted cash"), note: String(form.get("note") ?? "") });
    revalidatePath("/till", "layout");
    redirect(`/till/cash?closed=${r.tillId}`);
  });
}

export async function returnAction(input: ReturnInput): Promise<ActionState<{ returnId: number; returnNo: string; totalCents: number }>> {
  return runAction(async () => {
    const actor = await requireActor(["owner", "cashier"]);
    const r = await processReturn(actor, input);
    revalidatePath(`/till/receipts/${input.saleId}`);
    return r;
  });
}

export async function acknowledgeRelabelAction(variantIds: number[]): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor(["owner", "cashier"]);
    await acknowledgeRelabel(actor, variantIds);
    revalidatePath("/admin/labels"); revalidatePath("/till/labels"); revalidatePath("/admin");
  }, "Marked as relabelled.");
}
