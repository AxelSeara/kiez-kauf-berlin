import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_DIR = path.join(process.cwd(), "data", "moabit");
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter"
];

// Approximate Moabit bounds (Berlin, DE)
const MOABIT_BBOX = {
  south: 52.5171,
  west: 13.3196,
  north: 52.5485,
  east: 13.3798
};

const SHOP_REGEX =
  "supermarket|convenience|greengrocer|bakery|butcher|deli|organic|chemist|beverages|kiosk|health_food|department_store|mall|antiques|art|craft|stationery|beauty|cosmetics|perfumery|drugstore|medical_supply|orthopaedic|orthopedics|hardware|doityourself|household";

const PRODUCT_CATALOG = [
  { id: "pr_anchor_001", normalized_name: "hafermilch 1l", brand: "Oatly", category: "getraenke" },
  { id: "pr_anchor_002", normalized_name: "vollmilch 1l", brand: "", category: "getraenke" },
  { id: "pr_anchor_003", normalized_name: "eier 10 stueck", brand: "", category: "lebensmittel" },
  { id: "pr_anchor_004", normalized_name: "brot weizen", brand: "", category: "lebensmittel" },
  { id: "pr_anchor_005", normalized_name: "reis basmati 1kg", brand: "", category: "lebensmittel" },
  { id: "pr_anchor_006", normalized_name: "pasta fusilli 500g", brand: "Barilla", category: "lebensmittel" },
  { id: "pr_anchor_007", normalized_name: "tomatensauce 500g", brand: "", category: "lebensmittel" },
  { id: "pr_anchor_008", normalized_name: "olivenoel 1l", brand: "", category: "lebensmittel" },
  { id: "pr_anchor_009", normalized_name: "aepfel 1kg", brand: "", category: "frischwaren" },
  { id: "pr_anchor_010", normalized_name: "bananen 1kg", brand: "", category: "frischwaren" },
  { id: "pr_anchor_011", normalized_name: "kartoffeln 2kg", brand: "", category: "frischwaren" },
  { id: "pr_anchor_012", normalized_name: "zwiebeln 1kg", brand: "", category: "frischwaren" },
  { id: "pr_anchor_013", normalized_name: "zahnpasta sensitive", brand: "Elmex", category: "drogerie" },
  { id: "pr_anchor_014", normalized_name: "shampoo 300ml", brand: "", category: "drogerie" },
  { id: "pr_anchor_015", normalized_name: "waschmittel 20 wl", brand: "", category: "haushalt" },
  { id: "pr_anchor_016", normalized_name: "spuelmittel 500ml", brand: "", category: "haushalt" },
  { id: "pr_anchor_017", normalized_name: "toilettenpapier 8 rollen", brand: "", category: "haushalt" },
  { id: "pr_anchor_018", normalized_name: "kaffee gemahlen 500g", brand: "", category: "getraenke" },
  { id: "pr_anchor_019", normalized_name: "tee schwarz 25 beutel", brand: "", category: "getraenke" },
  { id: "pr_anchor_020", normalized_name: "wasser still 1.5l", brand: "", category: "getraenke" }
];

function escapeCsv(value) {
  const input = value == null ? "" : String(value);
  if (input.includes(",") || input.includes('"') || input.includes("\n")) {
    return `"${input.replaceAll('"', '""')}"`;
  }
  return input;
}

function toCsv(rows, headers) {
  const headerLine = headers.join(",");
  const lines = rows.map((row) => headers.map((key) => escapeCsv(row[key])).join(","));
  return [headerLine, ...lines].join("\n");
}

function buildOverpassQuery() {
  const { south, west, north, east } = MOABIT_BBOX;
  return `
[out:json][timeout:120];
(
  nwr["shop"~"${SHOP_REGEX}"](${south},${west},${north},${east});
  nwr["amenity"="pharmacy"](${south},${west},${north},${east});
);
out center tags;
`.trim();
}

function normalizeStore(rows) {
  const unique = new Map();

  for (const row of rows) {
    const lat = typeof row.lat === "number" ? row.lat : row.center?.lat;
    const lng = typeof row.lon === "number" ? row.lon : row.center?.lon;
    if (typeof lat !== "number" || typeof lng !== "number") {
      continue;
    }

    const tags = row.tags ?? {};
    const name = (tags.name ?? "").trim();
    if (!name) {
      continue;
    }

    const street = tags["addr:street"] ?? "";
    const house = tags["addr:housenumber"] ?? "";
    const postcode = tags["addr:postcode"] ?? "";
    const city = tags["addr:city"] ?? "Berlin";
    const district = tags["addr:suburb"] ?? tags["addr:district"] ?? "Moabit";
    const addressFull = [street, house].filter(Boolean).join(" ").trim();
    const address = [addressFull, postcode, city].filter(Boolean).join(", ");
    const shopType = tags.shop ?? tags.amenity ?? "";
    const openingHours = tags.opening_hours ?? "";
    const id = `osm_${row.type}_${row.id}`;

    unique.set(id, {
      id,
      name,
      address,
      district,
      opening_hours: openingHours,
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      shop_type: shopType,
      osm_ref: `${row.type}/${row.id}`,
      source: "osm-overpass"
    });
  }

  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, "de"));
}

function buildStoreProductTemplate(stores, products) {
  const now = new Date().toISOString();
  const rows = [];

  for (const store of stores) {
    for (const product of products) {
      rows.push({
        id: `sp_${store.id}_${product.id}`,
        store_id: store.id,
        product_id: product.id,
        status: "known_in_area",
        verified_at: now,
        notes: "pending-verification"
      });
    }
  }

  return rows;
}

async function main() {
  console.log("Fetching Moabit places from OpenStreetMap (Overpass)...");

  const query = buildOverpassQuery();
  let lastError = null;
  let payload = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(45000)
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        payload = await response.json();
        console.log(`Loaded data from ${endpoint} (attempt ${attempt})`);
        break;
      } catch (error) {
        lastError = error;
        console.warn(`Endpoint failed: ${endpoint} (attempt ${attempt})`);
      }
    }

    if (payload) {
      break;
    }
  }

  if (!payload) {
    throw new Error(`All Overpass endpoints failed. Last error: ${String(lastError)}`);
  }

  const elements = Array.isArray(payload.elements) ? payload.elements : [];
  const stores = normalizeStore(elements);
  const products = PRODUCT_CATALOG;
  const storeProductsTemplate = buildStoreProductTemplate(stores, products);

  await mkdir(OUTPUT_DIR, { recursive: true });

  const storesCsv = toCsv(stores, [
    "id",
    "name",
    "address",
    "district",
    "opening_hours",
    "lat",
    "lng",
    "shop_type",
    "osm_ref",
    "source"
  ]);
  const productsCsv = toCsv(products, ["id", "normalized_name", "brand", "category"]);
  const storeProductsCsv = toCsv(storeProductsTemplate, [
    "id",
    "store_id",
    "product_id",
    "status",
    "verified_at",
    "notes"
  ]);

  await writeFile(path.join(OUTPUT_DIR, "stores.csv"), storesCsv, "utf8");
  await writeFile(path.join(OUTPUT_DIR, "products.csv"), productsCsv, "utf8");
  await writeFile(path.join(OUTPUT_DIR, "store_products_template.csv"), storeProductsCsv, "utf8");

  console.log(`Created ${stores.length} stores in data/moabit/stores.csv`);
  console.log(`Created ${products.length} products in data/moabit/products.csv`);
  console.log(
    `Created ${storeProductsTemplate.length} product-store relations in data/moabit/store_products_template.csv`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
