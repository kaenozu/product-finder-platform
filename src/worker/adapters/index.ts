import { listModules } from "../../shared/domain/registry";
import type { ProductSourceAdapter } from "./types";
import { ManualRiceCookerAdapter } from "./manual";

const adapterFactories: Record<string, () => ProductSourceAdapter> = {
  "rice-cooker": () => new ManualRiceCookerAdapter(),
};

/** 登録済みカテゴリごとのアダプタを返す。未対応カテゴリはエラー。 */
export function getAdapter(categoryKey: string): ProductSourceAdapter {
  const factory = adapterFactories[categoryKey];
  if (!factory) {
    throw new Error(`no adapter registered for category: ${categoryKey}`);
  }
  return factory();
}

/** アダプタが存在するカテゴリキーの一覧（バッチ・seedはこれで走査する） */
export function listAdapterCategories(): string[] {
  return listModules().filter((key) => adapterFactories[key]);
}
