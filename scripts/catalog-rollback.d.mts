export function validateRollbackInput(input: {
  category?: string;
  version?: string;
  database?: string;
}): { category: string; version: string; database: string };
export function buildRollbackSql(category: string, version: string): string;
export function parseCatalogVersionRows(output: string): Array<{
  version_id: string;
  category_key: string;
  status: string;
}>;
