import Link from "next/link";
import { SUPPORTED_LOCALES } from "@/lib/locale";
import type { Locale } from "@/lib/types";

export function LanguageSwitcher({ locale, label }: { locale: Locale; label: string }) {
  return (
    <nav className="flex items-center gap-2 text-xs" aria-label={label}>
      <span className="mono text-[0.72rem] uppercase tracking-[0.12em] text-neutral-500">{label}</span>
      {SUPPORTED_LOCALES.map((item) => {
        const active = item === locale;

        return (
          <Link
            key={item}
            href={`/${item}`}
            className={`mono rounded-full border px-2.5 py-1 text-[0.72rem] uppercase tracking-[0.08em] transition ${
              active
                ? "border-[#1f4b7a] bg-[#1f4b7a] text-white"
                : "border-neutral-300 bg-white text-neutral-600 hover:border-[#1f4b7a] hover:text-[#1f4b7a]"
            }`}
          >
            {item.toUpperCase()}
          </Link>
        );
      })}
    </nav>
  );
}
