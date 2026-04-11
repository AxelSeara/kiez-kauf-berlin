import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { detectLocaleFromAcceptLanguage } from "@/lib/locale";

export default async function RootPage() {
  const requestHeaders = await headers();
  const locale = detectLocaleFromAcceptLanguage(requestHeaders.get("accept-language"));
  redirect(`/${locale}`);
}
