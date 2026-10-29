/** What /api/auth { action: "me" } answers. */
export interface Me {
  user: { email: string; role: "user" | "super_admin" } | null;
  /** Signed in with the dashboard password (GM). */
  gm: boolean;
}

/** Where to go after signing in: the dashboard for the super admin, game selection for everyone else. */
export function homeFor(role: "user" | "super_admin"): string {
  return role === "super_admin" ? "/admin" : "/games";
}
