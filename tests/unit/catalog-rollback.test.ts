import { describe, expect, it } from "vitest";
import {
  buildRollbackSql,
  parseCatalogVersionRows,
  validateRollbackInput,
} from "../../scripts/catalog-rollback.mjs";

describe("catalog rollback validation", () => {
  it.each([
    ["rice-cooker", "2026-08-23-valid"],
    ["home-audio", "v1"],
  ])("accepts safe category/version identifiers (%s, %s)", (category, version) => {
    expect(
      validateRollbackInput({ category, version, database: "product-finder-platform" })
    ).toEqual({
      category,
      version,
      database: "product-finder-platform",
    });
  });

  it.each([
    { category: "rice-cooker' OR 1=1 --", version: "v1", database: "product-finder-platform" },
    { category: "rice cooker", version: "v1", database: "product-finder-platform" },
    {
      category: "rice-cooker",
      version: "v1;DROP TABLE products",
      database: "product-finder-platform",
    },
    { category: "rice-cooker", version: "v1", database: "product-finder-platform;DROP" },
  ])("rejects SQL/control characters in CLI identifiers", (input) => {
    expect(() => validateRollbackInput(input)).toThrow(/英数字小文字とハイフン/);
  });

  it("builds SQL with escaped literals and a status/category guard", () => {
    expect(buildRollbackSql("rice-cooker", "2026-08-23-valid")).toBe(
      "INSERT INTO catalog_state (category_key, active_version_id, updated_at) " +
        "SELECT 'rice-cooker', '2026-08-23-valid', datetime('now') " +
        "WHERE EXISTS (SELECT 1 FROM catalog_versions " +
        "WHERE version_id = '2026-08-23-valid' AND category_key = 'rice-cooker' " +
        "AND status IN ('valid', 'published')) " +
        "ON CONFLICT(category_key) DO UPDATE SET " +
        "active_version_id = excluded.active_version_id, updated_at = excluded.updated_at;"
    );
  });

  it("recognizes only a matching valid or published catalog version", () => {
    expect(
      parseCatalogVersionRows(
        JSON.stringify([
          { results: [{ version_id: "v1", category_key: "rice-cooker", status: "valid" }] },
        ])
      )
    ).toEqual([{ version_id: "v1", category_key: "rice-cooker", status: "valid" }]);
    expect(parseCatalogVersionRows(JSON.stringify([{ results: [] }]))).toEqual([]);
  });
});
