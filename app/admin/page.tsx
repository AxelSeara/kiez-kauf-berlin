import { redirect } from "next/navigation";
import { getDefaultLocale } from "@/lib/locale";

export default function AdminRootRedirectPage() {
  redirect(`/${getDefaultLocale()}/admin`);
}

