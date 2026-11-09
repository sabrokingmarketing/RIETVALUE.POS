import { api } from "@/server/http";
import { requireActor } from "@/server/session";
import { getInvoice } from "@/server/invoices";
import { renderInvoicePdf } from "@/server/invoice-pdf";
import { invoiceFileName } from "@/server/invoice-mail";
import { getSettings } from "@/server/settings";
import { AppError } from "@/server/errors";

/** The invoice as an A4 PDF (inline, or as a download with ?download=1). */
export const GET = api(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor(["owner", "cashier"]);
  const inv = await getInvoice(actor, (await ctx.params).id);
  if (!inv) throw new AppError("NOT_FOUND", "Invoice not found");
  const pdf = await renderInvoicePdf(inv, { logoFile: (await getSettings()).logo_file });
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${invoiceFileName(inv)}"`,
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    },
  });
});
