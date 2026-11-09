"use server";
import { redirect } from "next/navigation";
import { createInitialOwner } from "@/server/users";
import { runAction, type ActionState } from "@/server/http";

export async function setupOwner(_: ActionState, form: FormData): Promise<ActionState> {
  const res = await runAction(() => createInitialOwner({
    name: String(form.get("name") ?? ""), email: String(form.get("email") ?? ""), password: String(form.get("password") ?? ""),
    role: "owner", setupToken: String(form.get("setupToken") ?? ""),
  }));
  if (res?.ok) redirect("/login?setup=1");
  return res;
}
