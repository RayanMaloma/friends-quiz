import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/auth/session";
import { homeFor } from "@/lib/auth";
import { AuthForm, AuthStage } from "@/components/auth/AuthForms";

export const metadata: Metadata = { title: "إنشاء حساب" };

export default async function Page() {
  const user = await currentUser({ refresh: false });
  if (user) redirect(homeFor(user.role));
  return (
    <AuthStage>
      <AuthForm mode="register" />
    </AuthStage>
  );
}
