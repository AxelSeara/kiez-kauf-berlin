import type { Locale } from "@/lib/types";

export const SUPPORTED_LOCALES: Locale[] = ["de", "en", "es"];

export function isSupportedLocale(locale: string): locale is Locale {
  return SUPPORTED_LOCALES.includes(locale as Locale);
}

export function getDefaultLocale(): Locale {
  const env = process.env.NEXT_PUBLIC_DEFAULT_LOCALE;
  if (env === "en" || env === "es" || env === "de") {
    return env;
  }
  return "de";
}

export function detectLocaleFromAcceptLanguage(value: string | null | undefined): Locale {
  if (!value) {
    return getDefaultLocale();
  }

  const languageTags = value
    .split(",")
    .map((part) => part.split(";")[0]?.trim().toLowerCase())
    .filter((part): part is string => Boolean(part));

  for (const tag of languageTags) {
    if (isSupportedLocale(tag)) {
      return tag;
    }

    const base = tag.split("-")[0];
    if (isSupportedLocale(base)) {
      return base;
    }
  }

  return getDefaultLocale();
}
