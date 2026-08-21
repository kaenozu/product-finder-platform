import type {
  CategoryCopy,
  QuestionDefinition,
  ProductOffer,
  SpecDisplayItem,
} from "../../shared/domain/types";

export interface ConfigResponse {
  categoryKey: string;
  questions: QuestionDefinition[];
  maxCandidates: number;
  scoreLabels: Record<string, string>;
  maxScore: number;
  partialEligibility: { type: "answered_at_least"; minAnswers: number };
  copy: CategoryCopy;
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
    sourceUpdatedAt: string;
    ingestedAt: string;
    imageUrl: string | null;
  };
  sources: Array<{ url: string; checkedAt: string }>;
  offers: ProductOffer[];
  reasons: Array<{ code: string; text: string }>;
  weakPoints: Array<{ code: string; text: string }>;
  scoreBreakdown: Record<string, number>;
  totalScore: number;
  specItems: SpecDisplayItem[];
}

export interface CategorySummary {
  categoryKey: string;
  questionCount: number;
  copy: {
    appTitle: string;
    heroTitle: string;
    heroLead: string;
    resultTitle: string;
    resultPreview?: CategoryCopy["resultPreview"];
  };
}

export interface CategoriesResponse {
  categories: CategorySummary[];
}

export interface EvaluateResponse {
  status: "partial" | "final";
  progress: { answered: number; estimatedTotal: number };
  criteria: Record<string, unknown>;
  noMatch: boolean;
  noMatchReasons: string[];
  matchedCount: number;
  warnings: string[];
  maxScore: number;
  scoreLabels: Record<string, string>;
  candidates: CandidateResponse[];
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error("通信がタイムアウトしました。もう一度お試しください", {
        cause: error,
      });
    }
    throw error;
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
      issues?: string[];
    } | null;
    throw new Error(body?.error ?? `request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export function fetchConfig(categoryKey?: string): Promise<ConfigResponse> {
  const query = categoryKey ? `?category=${encodeURIComponent(categoryKey)}` : "";
  return request<ConfigResponse>(`/api/config${query}`);
}

export function fetchCategories(): Promise<CategoriesResponse> {
  return request<CategoriesResponse>("/api/categories");
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
