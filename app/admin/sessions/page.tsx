import { redirect } from "next/navigation";

/** Rooms now live in the activity page (filters, details, end / delete). */
export default function AdminSessionsPage() {
  redirect("/admin/activity");
}
