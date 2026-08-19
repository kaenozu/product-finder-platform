import type { QuestionDefinition, ProductOffer, SpecDisplayItem } from "../../shared/domain/types";

export interface ConfigResponse {
  categoryKey: string;
  questions: QuestionDefinition[];
  maxCandidates: number;
  scoreLabels: Record<string, string>;
  maxScore: number;
}

export interface CandidateResponse {
  product: {
    productId: string;
    manufacturer: string;
    model: string;
    displayName: string;
    specs: Record<string, unknown>;
    referencePriceYen: number | null;
    availability: string;
  };
  sources: Array<{ url: string; checkedAt: string }>;
  offers: ProductOffer[];
  reasons: Array<{ code: string; text: string }>;
  scoreBreakdown: Record<string, number>;
  totalScore: number;
  specItems: SpecDisplayItem[];
}

export interface EvaluateResponse {
  status: "partial" | "final";
  progress: { answered: number; estimatedTotal: number };
  criteria: Record<string, unknown>;
  noMatch: boolean;
  noMatchReasons: string[];
  warnings: string[];
  maxScore: number;
  scoreLabels: Record<string, string>;
  candidates: CandidateResponse[];
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
      issues?: string[];
    } | null;
    throw new Error(body?.error ?? `request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export function fetchConfig(): Promise<ConfigResponse> {
  return request<ConfigResponse>("/api/config");
}

export function postEvaluate(
  categoryKey: string,
  answers: Record<string, string>
): Promise<EvaluateResponse> {
  return request<EvaluateResponse>("/api/diagnosis/evaluate", {
    method: "POST",
    body: JSON.stringify({ categoryKey, answers }),
  });
}
