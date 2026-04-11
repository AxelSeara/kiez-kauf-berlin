import { describe, expect, it } from "vitest";
import { __private } from "@/lib/data";

describe("keyword intent helpers", () => {
  it("maps multilingual generic terms to expected product groups", () => {
    expect(__private.inferProductGroupsFromKeyword("beer")).toContain("beverages");
    expect(__private.inferProductGroupsFromKeyword("cerveza")).toContain("beverages");
    expect(__private.inferProductGroupsFromKeyword("garlic")).toContain("fresh_produce");
    expect(__private.inferProductGroupsFromKeyword("knoblauch")).toContain("fresh_produce");
    expect(__private.inferProductGroupsFromKeyword("pliers")).toContain("household");
    expect(__private.inferProductGroupsFromKeyword("alicates")).toContain("household");
  });

  it("matches canonical products through EN/ES/DE names and synonyms", () => {
    const catalog = [
      {
        id: 18,
        normalized_name: "hafermilch 1l",
        display_name_en: "Oat milk 1L",
        display_name_es: "Leche de avena 1L",
        display_name_de: "Hafermilch 1L",
        synonyms: ["oat milk", "hafer drink"],
        product_group: "beverages"
      },
      {
        id: 19,
        normalized_name: "vollmilch 1l",
        display_name_en: "Whole milk 1L",
        display_name_es: "Leche entera 1L",
        display_name_de: "Vollmilch 1L",
        synonyms: ["milk 1l"],
        product_group: "beverages"
      }
    ];

    expect(__private.findCanonicalProductIdsByQuery("milk", catalog)).toEqual([18, 19]);
    expect(__private.findCanonicalProductIdsByQuery("leche", catalog)).toEqual([18, 19]);
    expect(__private.findCanonicalProductIdsByQuery("hafer", catalog)).toEqual([18]);
  });
});
