import { z } from "zod";
import { FEATURE_TAGS } from "../domain/rice-cooker/types";

/** 出典URLはhttpsに限定（未検証ドメインへの誘導を防ぐ） */
export const sourceRefSchema = z.object({
  url: z.url().refine((u) => u.startsWith("https://"), "出典URLはhttpsのみ"),
  checkedAt: z.string().min(1),
});

/**
 * 手動キュレーションレコードのバリデーションスキーマ。
 * 品質ゲート（schema gate）とアダプタのnormalizeで共用する。
 */
export const curatedRiceCookerRecordSchema = z.object({
  productId: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "productIdは小文字英数字とハイフンのみ"),
  imageUrl: z
    .string()
    .url("商品画像URLはhttps")
    .refine((u) => u.startsWith("https://"), "商品画像URLはhttpsのみ")
    .nullable(),
  manufacturer: z.string().min(1),
  model: z.string().min(1),
  displayName: z.string().min(1),
  capacityGou: z.number().positive().max(12),
  heatingMethod: z.enum(["micom", "ih", "pressure_ih"]),
  powerW: z.number().nonnegative().nullable(),
  weightKg: z.number().nonnegative().nullable(),
  widthMm: z.number().positive().nullable(),
  depthMm: z.number().positive().nullable(),
  heightMm: z.number().positive().nullable(),
  keepWarmHours: z.number().positive().nullable(),
  innerPot: z.string().min(1).nullable(),
  features: z.array(z.enum(FEATURE_TAGS)),
  releaseYear: z.number().int().min(2000).max(2100).nullable(),
  referencePriceYen: z.number().positive().nullable(),
  availability: z
    .enum(["in_stock", "low_stock", "out_of_stock", "unknown"])
    .optional()
    .default("unknown"),
  sources: z.array(sourceRefSchema).min(1, "出典URLが1件以上必要"),
});

export type CuratedRiceCookerRecord = z.infer<typeof curatedRiceCookerRecordSchema>;
