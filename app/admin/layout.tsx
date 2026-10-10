import type { Metadata } from "next";
import { isAdmin, isAdminConfigured, isDevPassword } from "@/lib/server/admin";
import { isSupabaseConfigured, rpc } from "@/lib/server/db";
import { AdminGate, AdminShell, type AdminWarning } from "@/components/admin/AdminShell";

export const metadata: Metadata = { title: "لوحة التحكم — ألعاب الشلّة" };

/** Must match fq_schema_version() in the latest migration. */
const SCHEMA_VERSION = 3;

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
      text: "قاعدة البيانات تحتاج تحديث: افتح Supabase ← SQL Editor وشغّل الملف supabase/migrations/20261009000000_platform.sql",
    });
  }
  if (isDevPassword()) {
    warnings.push({ level: "tip", text: "كلمة المرور الافتراضية «admin» شغّالة (وضع التطوير). حط ADMIN_PASSWORD في .env.local" });
  }
  if (!isSupabaseConfigured) {
    warnings.push({ level: "tip", text: "تشتغل على قاعدة بيانات محلية (.local-db) — للنشر الحقيقي اربط Supabase." });
  }

  return <AdminShell warnings={warnings}>{children}</AdminShell>;
}
