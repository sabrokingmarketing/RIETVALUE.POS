"use server";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/session";
import { runAction, type ActionState } from "@/server/http";
import { AppError } from "@/server/errors";
import { parseRandToCents } from "@/lib/money";
import {
  addAlias, createProduct, createVariant, retireAlias, setProductArchived, setProductPhoto, setVariantArchived, updateProduct, updateVariant,
  getVariant, searchVariants, type VariantRow,
} from "@/server/catalog";
import { adjustStock, receiveDelivery, type DeliveryInput } from "@/server/stock";
import { createPrintJob, savePreset, type PrintJobInput } from "@/server/labels";
import { updateSettings } from "@/server/settings";
import { createStaff, setStaffActive, setStaffPassword } from "@/server/users";
import { tx } from "@/server/db";
import { uploadDir } from "@/server/uploads";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
function price(f: FormData, k = "price"): number {
  const c = parseRandToCents(str(f, k));
  if (c === null || c <= 0) throw new AppError("VALIDATION", "Enter the selling price in rand, e.g. 89.90");
  return c;
}

function revalidateCatalogue() {
  revalidatePath("/admin", "layout");
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// Products & variants
// ---------------------------------------------------------------------------
function productFields(f: FormData) {
  return {
    commonName: str(f, "commonName"), botanicalName: str(f, "botanicalName"), categoryId: Number(str(f, "categoryId")),
    description: str(f, "description"), careNotes: str(f, "careNotes"),
  };
}

export async function createProductAction(_: ActionState, f: FormData): Promise<ActionState> {
  let id = 0;
  const res = await runAction(async () => {
    const actor = await requireActor(["owner"]);
    id = await tx(async (c) => {
      const pid = await createProduct(actor, productFields(f), c);
      await createVariant(actor, pid, {
        sizeLabel: str(f, "sizeLabel"), sku: str(f, "sku"), priceCents: price(f), lowStockThreshold: Number(str(f, "lowStockThreshold") || 3),
        isPublic: f.get("isPublic") === "on", aliasBarcode: str(f, "aliasBarcode"),
      }, c);
      return pid;
    });
    await savePhoto(actor, id, f);
    revalidateCatalogue();
  });
  if (res?.ok) redirect(`/admin/products/${id}?created=1`);
  return res;
}

export async function updateProductAction(id: number, _: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor(["owner"]);
    await updateProduct(actor, id, productFields(f));
    await savePhoto(actor, id, f);
    revalidateCatalogue();
  }, "Product saved.");
}

const MAX_PHOTO = 5 * 1024 * 1024;
async function savePhoto(actor: Awaited<ReturnType<typeof requireActor>>, productId: number, f: FormData) {
  const file = f.get("photo");
  if (!(file instanceof File) || file.size === 0) return;
  if (file.size > MAX_PHOTO) throw new AppError("VALIDATION", "Photo is larger than 5 MB. Use a smaller photo.");
  const buf = Buffer.from(await file.arrayBuffer());
  // Trust the bytes, not the file name or browser-supplied type.
  const ext = buf[0] === 0xff && buf[1] === 0xd8 ? "jpg"
    : buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? "png"
    : buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP" ? "webp" : null;
  if (!ext) throw new AppError("VALIDATION", "Photo must be a JPEG, PNG or WebP image.");
  const dir = uploadDir();
  await fs.mkdir(dir, { recursive: true });
  const name = `${randomUUID()}.${ext}`;
  await fs.writeFile(path.join(/*turbopackIgnore: true*/ dir, name), buf, { flag: "wx" });
  await setProductPhoto(actor, productId, name);
}

export async function setProductArchivedAction(id: number, archived: boolean): Promise<ActionState> {
  return runAction(async () => {
    await setProductArchived(await requireActor(["owner"]), id, archived);
    revalidateCatalogue();
  }, archived ? "Product archived. Its sales history is kept." : "Product restored.");
}

export async function createVariantAction(productId: number, _: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor(["owner"]);
    await createVariant(actor, productId, {
      sizeLabel: str(f, "sizeLabel"), sku: str(f, "sku"), priceCents: price(f), lowStockThreshold: Number(str(f, "lowStockThreshold") || 3),
      isPublic: f.get("isPublic") === "on", aliasBarcode: str(f, "aliasBarcode"),
    });
    revalidateCatalogue();
  }, "Size added. Print labels before putting it on the shelf.");
}

export async function updateVariantAction(variantId: number, _: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor(["owner"]);
    const r = await updateVariant(actor, variantId, {
      sizeLabel: str(f, "sizeLabel"), sku: str(f, "sku"), priceCents: price(f), lowStockThreshold: Number(str(f, "lowStockThreshold") || 0),
      isPublic: f.get("isPublic") === "on",
    });
    revalidateCatalogue();
    return r;
  }, "Saved.");
}

export async function setVariantArchivedAction(variantId: number, archived: boolean): Promise<ActionState> {
  return runAction(async () => {
    await setVariantArchived(await requireActor(["owner"]), variantId, archived);
    revalidateCatalogue();
  }, archived ? "Archived. Its barcode stops scanning and will never be reused." : "Restored.");
}

export async function addAliasAction(variantId: number, _: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    await addAlias(await requireActor(["owner"]), variantId, str(f, "code"));
    revalidateCatalogue();
  }, "Supplier barcode added.");
}

export async function retireAliasAction(code: string): Promise<ActionState> {
  return runAction(async () => {
    await retireAlias(await requireActor(["owner"]), code);
    revalidateCatalogue();
  }, "Supplier barcode retired.");
}

// ---------------------------------------------------------------------------
// Receiving
// ---------------------------------------------------------------------------
export async function searchVariantsAction(term: string): Promise<VariantRow[]> {
  await requireActor(["owner", "cashier"]);
  return searchVariants(term.slice(0, 60), { limit: 15 });
}

export async function receiveDeliveryAction(input: DeliveryInput) {
  return runAction(async () => {
    const r = await receiveDelivery(await requireActor(["owner"]), input);
    revalidateCatalogue();
    return r;
  });
}

/** Create a plant + size on the receiving screen, returning the variant ready to add to the delivery. */
export async function quickCreateAction(input: { commonName: string; botanicalName: string; categoryId: number; sizeLabel: string; price: string; isPublic: boolean }) {
  return runAction(async () => {
    const actor = await requireActor(["owner"]);
    const cents = parseRandToCents(input.price);
    if (cents === null || cents <= 0) throw new AppError("VALIDATION", "Enter the selling price in rand, e.g. 89.90");
    const vid = await tx(async (c) => {
      const pid = await createProduct(actor, { commonName: input.commonName, botanicalName: input.botanicalName, categoryId: input.categoryId }, c);
      return createVariant(actor, pid, { sizeLabel: input.sizeLabel, priceCents: cents, isPublic: input.isPublic }, c);
    });
    revalidateCatalogue();
    return (await getVariant(vid))!;
  });
}

export async function addSizeQuickAction(input: { productId: number; sizeLabel: string; price: string; isPublic: boolean }) {
  return runAction(async () => {
    const actor = await requireActor(["owner"]);
    const cents = parseRandToCents(input.price);
    if (cents === null || cents <= 0) throw new AppError("VALIDATION", "Enter the selling price in rand, e.g. 89.90");
    const vid = await createVariant(actor, input.productId, { sizeLabel: input.sizeLabel, priceCents: cents, isPublic: input.isPublic });
    revalidateCatalogue();
    return (await getVariant(vid))!;
  });
}

// ---------------------------------------------------------------------------
// Labels (owner and cashier may print; printing never touches stock)
// ---------------------------------------------------------------------------
export async function createPrintJobAction(input: PrintJobInput) {
  return runAction(async () => createPrintJob(await requireActor(["owner", "cashier"]), input));
}

export async function savePresetAction(id: number | null, _: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    await savePreset(await requireActor(["owner"]), id, {
      name: str(f, "name"), kind: str(f, "kind") as "roll" | "sheet",
      pageWidthMm: str(f, "pageWidthMm"), pageHeightMm: str(f, "pageHeightMm"), labelWidthMm: str(f, "labelWidthMm"), labelHeightMm: str(f, "labelHeightMm"),
      marginTopMm: str(f, "marginTopMm"), marginLeftMm: str(f, "marginLeftMm"), pitchXMm: str(f, "pitchXMm"), pitchYMm: str(f, "pitchYMm"),
      columns: str(f, "columns"), rows: str(f, "rows"), paddingMm: str(f, "paddingMm"), moduleMm: str(f, "moduleMm"), isDefault: f.get("isDefault") === "on",
    });
    revalidatePath("/admin/labels", "layout");
  }, "Label preset saved.");
}

// ---------------------------------------------------------------------------
// Stock adjustments
// ---------------------------------------------------------------------------
export async function adjustStockAction(variantId: number, _: ActionState, f: FormData): Promise<ActionState<{ onHand: number; delta: number }>> {
  return runAction(async () => {
    const actor = await requireActor(["owner"]);
    const reason = str(f, "reason");
    const note = str(f, "note");
    const r = reason === "count_correction"
      ? await adjustStock(actor, { reason, variantId, countedQuantity: Number(str(f, "counted")), note })
      : await adjustStock(actor, { reason: reason as "damage" | "plant_loss", variantId, quantity: Number(str(f, "quantity")), note });
    revalidateCatalogue();
    return r;
  });
}

// ---------------------------------------------------------------------------
// Settings & staff
// ---------------------------------------------------------------------------
export async function updateSettingsAction(_: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    await updateSettings(await requireActor(["owner"]), {
      businessName: str(f, "businessName"), legalName: str(f, "legalName"), registrationNo: str(f, "registrationNo"),
      vatRegistered: f.get("vatRegistered") === "on", vatNumber: str(f, "vatNumber").replace(/\s/g, ""), vatRatePercent: str(f, "vatRatePercent") || "15",
      addressLines: str(f, "addressLines"), phone: str(f, "phone"), whatsappNumber: str(f, "whatsappNumber"), email: str(f, "email"),
      openingHours: str(f, "openingHours"), mapUrl: str(f, "mapUrl"), directions: str(f, "directions"), tagline: str(f, "tagline"),
      aboutText: str(f, "aboutText"), receiptFooter: str(f, "receiptFooter"),
    });
    revalidatePath("/", "layout");
  }, "Settings saved. New sales use these details; past receipts keep theirs.");
}

export async function createStaffAction(_: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    await createStaff(await requireActor(["owner"]), {
      name: str(f, "name"), email: str(f, "email"), password: str(f, "password"), role: str(f, "role") === "owner" ? "owner" : "cashier",
    });
    revalidatePath("/admin/staff");
  }, "Staff member added. Give them their e-mail and password in person.");
}

export async function setStaffActiveAction(userId: string, active: boolean): Promise<ActionState> {
  return runAction(async () => {
    await setStaffActive(await requireActor(["owner"]), userId, active);
    revalidatePath("/admin/staff");
  }, active ? "Reactivated." : "Deactivated and signed out everywhere.");
}

export async function setStaffPasswordAction(userId: string, _: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    await setStaffPassword(await requireActor(["owner"]), userId, str(f, "password"));
    revalidatePath("/admin/staff");
  }, "Password changed. They have been signed out and must use the new password.");
}
