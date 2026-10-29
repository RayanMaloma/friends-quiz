import type { Metadata } from "next";
import { isAdmin, isAdminConfigured, isDevPassword } from "@/lib/server/admin";
import { isSupabaseConfigured, rpc } from "@/lib/server/db";
import { AdminGate, AdminShell, type AdminWarning } from "@/components/admin/AdminShell";
import { currentUser } from "@/lib/server/auth/session";

export const metadata: Metadata = { title: "لوحة التحكم" };

/** Must match fq_schema_version() in the latest migration. */
const SCHEMA_VERSION = 7;

async function schemaVersion(): Promise<number> {
  try {
    return await rpc<number>("fq_schema_version", {});
  } catch {
    return 0;
  }
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdmin())) return <AdminGate configured={isAdminConfigured()} />;

  const version = await schemaVersion();
  const warnings: AdminWarning[] = [];
  if (version < SCHEMA_VERSION) {
    warnings.push({
      level: "blocking",
      text: version < 3
        ? "قاعدة البيانات تحتاج تحديث: افتح Supabase ← SQL Editor وشغّل الملفات supabase/migrations/20261009000000_platform.sql ثم 20261018000000_deduction.sql"
        : version < 4
          ? "قاعدة البيانات تحتاج تحديث لألعاب الأدوار السرّية: افتح Supabase ← SQL Editor وشغّل الملف supabase/migrations/20261018000000_deduction.sql"
          : version < 6
            ? `قاعدة البيانات تحتاج تحديث: افتح Supabase ← SQL Editor وشغّل ${version < 5 ? "20261028000000_mafia.sql ثم " : ""}20261029000000_invent.sql ثم 20261030000000_accounts.sql من supabase/migrations`
            : "قاعدة البيانات تحتاج تحديث للحسابات: افتح Supabase ← SQL Editor وشغّل supabase/migrations/20261030000000_accounts.sql",
    });
  }
  if (isDevPassword()) {
    warnings.push({ level: "tip", text: "كلمة المرور الافتراضية «admin» شغّالة (وضع التطوير). حط ADMIN_PASSWORD في .env.local" });
  }
  if (!isSupabaseConfigured) {
    warnings.push({ level: "tip", text: "تشتغل على قاعدة بيانات محلية (.local-db) — للنشر الحقيقي اربط Supabase." });
  }

  const user = await currentUser({ refresh: false });
  return (
    <AdminShell warnings={warnings} email={user?.email ?? null}>
      {children}
    </AdminShell>
  );
}
