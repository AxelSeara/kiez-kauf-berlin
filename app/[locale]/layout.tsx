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
    <div className="mx-auto min-h-screen w-full max-w-6xl px-4 pb-8 pt-4 md:px-8 md:pt-5">
      <header className="note-card mb-4 overflow-hidden px-4 py-3 md:px-5 md:py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight md:text-[1.7rem]">{dictionary.appTitle}</h1>
            <p className="mt-0.5 max-w-xl text-xs text-neutral-700 md:text-sm">{dictionary.appSubtitle}</p>
          </div>
          <LanguageSwitcher locale={locale} label={dictionary.languageLabel} />
        </div>
      </header>
      {children}
    </div>
  );
}
