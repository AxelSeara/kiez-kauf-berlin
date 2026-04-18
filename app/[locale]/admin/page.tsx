import { notFound } from "next/navigation";
import { AdminPanel } from "@/components/AdminPanel";
import { isSupportedLocale } from "@/lib/locale";

export default async function LocaleAdminPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) {
    notFound();
  }

  return <AdminPanel locale={locale} />;
}

