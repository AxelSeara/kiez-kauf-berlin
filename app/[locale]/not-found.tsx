"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getDictionary } from "@/lib/i18n";
import { getDefaultLocale, isSupportedLocale } from "@/lib/locale";

export default function LocaleNotFoundPage() {
  const pathname = usePathname();
  const candidate = pathname.split("/").filter(Boolean)[0] ?? "";
  const locale = isSupportedLocale(candidate) ? candidate : getDefaultLocale();
  const dictionary = getDictionary(locale);

  return (
    <main className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
      <h2 className="text-2xl font-bold">{dictionary.notFoundTitle}</h2>
      <p className="mt-2 text-slate-600">{dictionary.notFoundDescription}</p>
      <Link href="/" className="mt-4 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-white">
        {dictionary.backHome}
      </Link>
    </main>
  );
}
