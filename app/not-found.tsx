import Link from "next/link";
import { getDictionary } from "@/lib/i18n";
import { getDefaultLocale } from "@/lib/locale";

export default function NotFoundPage() {
  const dictionary = getDictionary(getDefaultLocale());

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-3xl font-bold">{dictionary.notFoundTitle}</h1>
      <p className="text-slate-600">{dictionary.notFoundDescription}</p>
      <Link href="/" className="rounded-lg bg-slate-900 px-4 py-2 text-white">
        {dictionary.backHome}
      </Link>
    </main>
  );
}
