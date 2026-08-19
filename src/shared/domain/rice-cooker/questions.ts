import type { QuestionDefinition } from "../types";
import type { RiceCookerAnswerKey } from "./types";

const order = (order: number) => order;

export const QUESTIONS: QuestionDefinition[] = [
  {
    key: "cookVolume",
    title: "一回に炊くご飯の量は?",
    description: "いちばん多い使用シーンの量を選んでください。",
    required: true,
    order: order(0),
    options: [
      { value: "2", label: "2合（1〜2人分）", next: "heating" },
      { value: "3", label: "3合（2〜3人分）", next: "heating" },
      { value: "4", label: "4合（3〜4人分）", next: "heating" },
      { value: "5", label: "5合（4〜5人分）", next: "heating" },
      { value: "5.5", label: "5.5合（5人以上）", next: "heating" },
    ],
  },
  {
    key: "heating",
    title: "加熱方式はこだわりますか?",
    description: "予算と炊き上がりのバランスに影響します。",
    required: true,
    order: order(1),
    options: [
      {
        value: "pressure_ih",
        label: "圧力IH炊飯器",
        description: "香り・甘み重視で価格は高め",
        next: "budget",
      },
      { value: "ih", label: "IH炊飯器", description: "火力が強くうまみを引き出す", next: "budget" },
      {
        value: "micom",
        label: "マイコン炊飯器",
        description: "手頃な価格で選べる",
        next: "budget",
      },
      { value: "any", label: "特にこだわらない", next: "budget" },
    ],
  },
  {
    key: "budget",
    title: "予算の目安は?",
    required: true,
    order: order(2),
    options: [
      { value: "under10k", label: "1万円未満", next: "priority" },
      { value: "10to20k", label: "1〜2万円", next: "priority" },
      { value: "20to30k", label: "2〜3万円", next: "priority" },
      { value: "over30k", label: "3万円以上", next: "priority" },
      { value: "any", label: "こだわらない", next: "priority" },
    ],
  },
  {
    key: "priority",
    title: "特に重視するのは?",
    required: true,
    order: order(3),
    options: [
      { value: "taste", label: "炊き上がりの味", next: "installWidth" },
      {
        value: "functions",
        label: "便利な機能",
        description: "同時調理・蒸しなど",
        next: "useTacook",
      },
      { value: "keepwarm", label: "長時間保温", next: "installWidth" },
      {
        value: "ease",
        label: "軽さ・取り回し",
        description: "毎日持ち運ぶ・洗う負担を軽く",
        next: "installWidth",
      },
      { value: "compact", label: "コンパクトさ", next: "installWidth" },
    ],
  },
  {
    key: "useTacook",
    title: "同時調理（ごはんと一緒におかず）を使いたい?",
    description: "タイガーの「ごはんdeおかず」など同時調理対応モデルの候補を優先します。",
    required: true,
    order: order(4),
    options: [
      { value: "yes", label: "使いたい", next: "installWidth" },
      { value: "no", label: "特に必要ない", next: "installWidth" },
    ],
  },
  {
    key: "installWidth",
    title: "置き場所の幅の制限は?",
    description: "本体幅が入るかどうかの判定に使います。",
    required: true,
    order: order(5),
    options: [
      { value: "under24", label: "幅24cm以下", next: null },
      { value: "under25", label: "幅25cm以下", next: null },
      { value: "under27", label: "幅27cm以下", next: null },
      { value: "free", label: "制限なし", next: null },
    ],
  },
];

export const QUESTION_KEYS: RiceCookerAnswerKey[] = QUESTIONS.map(
  (q) => q.key as RiceCookerAnswerKey
);
