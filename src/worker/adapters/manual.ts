import { CURATED_RICE_COOKERS, RICE_COOKER_CHECKED_AT } from "../data/rice-cooker";
import { curatedRiceCookerRecordSchema } from "../../shared/schema/rice-cooker";
import type { RiceCookerProduct } from "../../shared/domain/rice-cooker/types";
import type {
  FetchedResult,
  NormalizeContext,
  NormalizedResult,
  ProductSourceAdapter,
} from "./types";

export const MANUAL_RICE_COOKER_SOURCE = "manual-curated";

function toRiceCookerProduct(
  record: ReturnType<typeof curatedRiceCookerRecordSchema.parse>,
  now: Date,
  sourceUpdatedAt: string
): RiceCookerProduct {
  return {
    productId: record.productId,
    categoryKey: "rice-cooker",
    manufacturer: record.manufacturer,
    model: record.model,
    displayName: record.displayName,
    specs: {
      imageUrl: record.imageUrl,
      capacityGou: record.capacityGou,
      heatingMethod: record.heatingMethod,
      powerW: record.powerW,
      weightKg: record.weightKg,
      widthMm: record.widthMm,
      depthMm: record.depthMm,
      heightMm: record.heightMm,
      keepWarmHours: record.keepWarmHours,
      innerPot: record.innerPot,
      features: record.features,
      releaseYear: record.releaseYear,
      _sources: record.sources.map((s) => ({ url: s.url, checkedAt: s.checkedAt })),
    },
    referencePriceYen: record.referencePriceYen,
    availability: record.availability ?? "unknown",
    sourceKey: MANUAL_RICE_COOKER_SOURCE,
    sourceUpdatedAt,
    ingestedAt: now.toISOString(),
  };
}

/**
 * 手動キュレーションアダプタ。
 * fetchはネットワークを伴わず静的データを返す。normalizeで zod バリデーション + 商品モデル変換を行う。
 */
export class ManualRiceCookerAdapter implements ProductSourceAdapter {
  readonly sourceKey = MANUAL_RICE_COOKER_SOURCE;

  async fetch(): Promise<FetchedResult> {
    return {
      raw: CURATED_RICE_COOKERS,
      meta: {
        sourceKey: this.sourceKey,
        sourceUpdatedAt: RICE_COOKER_CHECKED_AT,
        fetchedCount: CURATED_RICE_COOKERS.length,
      },
    };
  }

  async normalize(raw: FetchedResult, ctx: NormalizeContext): Promise<NormalizedResult> {
    const products: RiceCookerProduct[] = [];
    const rejectedReasons: string[] = [];
    let rejectedCount = 0;

    for (const record of raw.raw) {
      const parsed = curatedRiceCookerRecordSchema.safeParse(record);
      if (!parsed.success) {
        rejectedCount += 1;
        rejectedReasons.push(
          `invalid record: ${parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join(", ")}`
        );
        continue;
      }
      products.push(toRiceCookerProduct(parsed.data, ctx.now, raw.meta.sourceUpdatedAt));
    }

    return { products, offers: [], rejectedCount, rejectedReasons };
  }
}
