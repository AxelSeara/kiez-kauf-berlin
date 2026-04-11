import { notFound } from "next/navigation";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { getDictionary } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";

export default async function LocaleLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const dictionary = getDictionary(locale);

  return (
    <div className="mx-auto min-h-screen w-full max-w-[1180px] px-4 pb-8 pt-4 md:px-8 md:pt-6">
      <header className="surface-card mb-5 px-4 py-4 md:px-6 md:py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="section-title">Berlin local search</p>
            <h1 className="text-2xl font-semibold tracking-tight md:text-[1.95rem]">{dictionary.appTitle}</h1>
            <p className="max-w-2xl text-sm text-neutral-600 md:text-[0.97rem]">{dictionary.appSubtitle}</p>
          </div>
          <LanguageSwitcher locale={locale} label={dictionary.languageLabel} />
        </div>
      </header>
      {children}
    </div>
  );
}
