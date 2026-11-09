import { redirect } from "next/navigation";

/** The system has no public website: the root goes straight to the till (or sign-in). */
export default function Root() {
  redirect("/till");
}
