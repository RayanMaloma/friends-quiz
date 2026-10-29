import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/auth/session";
import { hasAdminPasswordCookie } from "@/lib/server/admin";
import { NewRoomForm } from "@/components/invent/NewRoomForm";

/** Opening a room needs an account (checked again by /api/invent). */
export default async function NewInventRoomPage() {
  if (!(await currentUser({ refresh: false })) && !(await hasAdminPasswordCookie())) redirect("/games");
  return <NewRoomForm />;
}
