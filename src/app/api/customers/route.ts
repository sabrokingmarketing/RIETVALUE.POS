import { api } from "@/server/http";
import { requireActor } from "@/server/session";
import { searchCustomers } from "@/server/invoices";

/** Customer book lookup for invoice forms: ?q=name, e-mail, company or phone (2+ characters). */
export const GET = api(async (req: Request) => {
  const actor = await requireActor(["owner", "cashier"]);
  return { customers: await searchCustomers(actor, new URL(req.url).searchParams.get("q") ?? "") };
});
