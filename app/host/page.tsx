import { redirect } from "next/navigation";

/** The old TV entry: game selection now lives at /games (accounts, public / private games). */
export default function HostEntryPage() {
  redirect("/games");
}
