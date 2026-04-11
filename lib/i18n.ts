import type { Locale } from "@/lib/types";

export type Dictionary = {
  appTitle: string;
  appSubtitle: string;
  noteBadge: string;
  noteTagline: string;
  headerLinePrimary: string;
  headerLineSecondary: string;
  searchPlaceholder: string;
  radiusLabel: string;
  searchButton: string;
  useMyLocation: string;
  addressSectionTitle: string;
  addressSectionHint: string;
  locationFallbackLabel: string;
  locationFallbackPlaceholder: string;
  resolveLocationButton: string;
  resultsTitle: string;
  noResults: string;
  openStore: string;
  routeAction: string;
  matchedProductLabel: string;
  storeProductsTitle: string;
  priceUnknown: string;
  availabilityInStock: string;
  availabilityLowStock: string;
  availabilityUnknown: string;
  updatedLabel: string;
  centerLabel: string;
  languageLabel: string;
  geolocationError: string;
  geolocationReady: string;
  queryRequiredError: string;
  searchRequestError: string;
  mapYouAreHere: string;
  storeNoteBadge: string;
  itemLabel: string;
  backToSearch: string;
  notFoundTitle: string;
  notFoundDescription: string;
  backHome: string;
};

const dictionaries: Record<Locale, Dictionary> = {
  de: {
    appTitle: "KiezKauf Berlin",
    appSubtitle: "Finde Produkte in Geschaeften in deiner Naehe.",
    noteBadge: "Einkaufsnotiz",
    noteTagline: "Notieren, finden, losgehen.",
    headerLinePrimary: "Bereit fuer exakte Produktsuche in deiner Naehe.",
    headerLineSecondary: "Kein Login. Schnell. Lokal.",
    searchPlaceholder: "Produkt exakt suchen (z. B. Hafermilch 1L)",
    radiusLabel: "Suchradius (km)",
    searchButton: "Produkte suchen",
    useMyLocation: "Meinen Standort nutzen",
    addressSectionTitle: "Deine Adresse",
    addressSectionHint: "Du kannst Strasse + Hausnummer oder Postleitzahl eingeben.",
    locationFallbackLabel: "Fallback ohne GPS",
    locationFallbackPlaceholder: "Adresse oder Postleitzahl in Berlin",
    resolveLocationButton: "Adresse auf Karte finden",
    resultsTitle: "Ergebnisse in deiner Naehe",
    noResults: "Keine Treffer im Radius. Probiere einen groesseren Radius oder einen anderen Produktnamen.",
    openStore: "Details zur Filiale",
    routeAction: "Route starten",
    matchedProductLabel: "Produkt",
    storeProductsTitle: "Produkte in dieser Filiale",
    priceUnknown: "Preis nicht verfuegbar",
    availabilityInStock: "Auf Lager",
    availabilityLowStock: "Wenig Bestand",
    availabilityUnknown: "Verfuegbarkeit unbekannt",
    updatedLabel: "Aktualisiert",
    centerLabel: "Zentrum",
    languageLabel: "Sprache",
    geolocationError: "Standort konnte nicht ermittelt werden. Bitte Fallback verwenden.",
    geolocationReady: "Standort aktiv",
    queryRequiredError: "Bitte gib einen Produktnamen ein.",
    searchRequestError: "Die Suche ist fehlgeschlagen.",
    mapYouAreHere: "Dein Standort",
    storeNoteBadge: "Filialnotiz",
    itemLabel: "Artikel",
    backToSearch: "Zurueck zur Suche",
    notFoundTitle: "Nicht gefunden",
    notFoundDescription: "Die Seite oder Filiale ist nicht verfuegbar.",
    backHome: "Zur Startseite"
  },
  en: {
    appTitle: "KiezKauf Berlin",
    appSubtitle: "Find products in local shops near you.",
    noteBadge: "Shopping Note",
    noteTagline: "Write it, find it, walk there.",
    headerLinePrimary: "Ready to search exact products and buy nearby.",
    headerLineSecondary: "No login. Fast. Local.",
    searchPlaceholder: "Search exact product (e.g. oat milk 1L)",
    radiusLabel: "Search radius (km)",
    searchButton: "Search products",
    useMyLocation: "Use my location",
    addressSectionTitle: "Your address",
    addressSectionHint: "Enter a street address or a postal code in Berlin.",
    locationFallbackLabel: "Fallback without GPS",
    locationFallbackPlaceholder: "Address or postal code in Berlin",
    resolveLocationButton: "Find address on map",
    resultsTitle: "Results near you",
    noResults: "No matches in this radius. Try a wider radius or another product name.",
    openStore: "Store details",
    routeAction: "Get directions",
    matchedProductLabel: "Product",
    storeProductsTitle: "Products in this store",
    priceUnknown: "Price unavailable",
    availabilityInStock: "In stock",
    availabilityLowStock: "Low stock",
    availabilityUnknown: "Availability unknown",
    updatedLabel: "Updated",
    centerLabel: "Center",
    languageLabel: "Language",
    geolocationError: "We could not detect your location. Please use fallback.",
    geolocationReady: "Location ready",
    queryRequiredError: "Please provide a product query.",
    searchRequestError: "Search request failed.",
    mapYouAreHere: "You are here",
    storeNoteBadge: "Store Note",
    itemLabel: "Item",
    backToSearch: "Back to search",
    notFoundTitle: "Not found",
    notFoundDescription: "The page or store is not available.",
    backHome: "Back home"
  },
  es: {
    appTitle: "KiezKauf Berlin",
    appSubtitle: "Encuentra productos en tiendas locales cerca de ti.",
    noteBadge: "Nota de compra",
    noteTagline: "Apuntalo, encuentralo, ve a por ello.",
    headerLinePrimary: "Listo para buscar productos exactos y comprar cerca.",
    headerLineSecondary: "Sin registro. Rapido. Local.",
    searchPlaceholder: "Busca un producto exacto (por ej. leche de avena 1L)",
    radiusLabel: "Radio de busqueda (km)",
    searchButton: "Buscar productos",
    useMyLocation: "Usar mi ubicacion",
    addressSectionTitle: "Tu direccion",
    addressSectionHint: "Puedes escribir calle y numero o codigo postal en Berlin.",
    locationFallbackLabel: "Modo manual sin GPS",
    locationFallbackPlaceholder: "Direccion o codigo postal en Berlin",
    resolveLocationButton: "Buscar direccion en el mapa",
    resultsTitle: "Resultados cerca de ti",
    noResults: "No hay resultados en este radio. Prueba con un radio mayor u otro producto.",
    openStore: "Ver tienda",
    routeAction: "Como llegar",
    matchedProductLabel: "Producto",
    storeProductsTitle: "Productos en esta tienda",
    priceUnknown: "Precio no disponible",
    availabilityInStock: "En stock",
    availabilityLowStock: "Queda poco",
    availabilityUnknown: "Disponibilidad desconocida",
    updatedLabel: "Actualizado",
    centerLabel: "Centro",
    languageLabel: "Idioma",
    geolocationError: "No se pudo obtener tu ubicacion. Usa el modo manual.",
    geolocationReady: "Ubicacion lista",
    queryRequiredError: "Escribe un producto para buscar.",
    searchRequestError: "La busqueda ha fallado.",
    mapYouAreHere: "Tu ubicacion",
    storeNoteBadge: "Nota de tienda",
    itemLabel: "Articulo",
    backToSearch: "Volver a la busqueda",
    notFoundTitle: "No encontrado",
    notFoundDescription: "La pagina o la tienda no esta disponible.",
    backHome: "Volver al inicio"
  }
};

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
