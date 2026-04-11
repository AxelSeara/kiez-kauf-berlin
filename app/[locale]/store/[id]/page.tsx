import Link from "next/link";
import { notFound } from "next/navigation";
import { buildDirectionsUrl } from "@/lib/maps";
import { getStoreDetail } from "@/lib/data";
import { getDictionary } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";

export default async function StoreDetailPage({
  params
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const dictionary = getDictionary(locale);
  const detail = await getStoreDetail(id);

  if (!detail) {
    notFound();
  }

  return (
    <main className="space-y-4 md:space-y-5">
      <Link href={`/${locale}`} className="mono text-sm text-neutral-600 hover:text-[#1f4b7a]">
        {"<-"} {dictionary.backToSearch}
      </Link>

      <section className="surface-card p-5 md:p-6">
        <p className="section-title">{dictionary.storeNoteBadge}</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">{detail.store.name}</h2>
        <p className="mt-1 text-sm text-neutral-600">{detail.store.address}</p>
        <p className="mono mt-1 text-xs text-neutral-500">{detail.store.openingHours}</p>

        <a
          href={buildDirectionsUrl({
            destinationLat: detail.store.lat,
            destinationLng: detail.store.lng
          })}
          target="_blank"
          rel="noreferrer"
          className="btn-primary mt-4 inline-flex px-4 py-2 text-sm font-medium"
        >
          {dictionary.routeAction}
        </a>
      </section>

      <section className="surface-card p-5 md:p-6">
        <h3 className="mb-3 text-xl font-semibold tracking-tight">{dictionary.storeProductsTitle}</h3>
        <ul className="space-y-3">
          {detail.offers.map((item, index) => (
            <li key={item.offer.id} className="rounded-xl border border-[#dbe1e8] bg-[#f8fafc] p-3">
              <p className="mono mb-1 text-[0.7rem] uppercase tracking-[0.13em] text-neutral-500">
                {dictionary.itemLabel} {String(index + 1).padStart(2, "0")}
              </p>
              <p className="text-sm font-medium text-neutral-800">{item.product.normalizedName}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
