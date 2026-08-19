interface Props {
  onStart: () => void;
}

const BENEFITS = [
  { title: "人数に合う容量", text: "家族構成から必要な合数で絞り込み" },
  { title: "使い方に合う機能", text: "同時調理・保温・手入れのしやすさを比較" },
  { title: "予算に合う価格", text: "オープン価格も参考価格で整理" },
];

export function StartScreen({ onStart }: Props) {
  return (
    <div className="start">
      <p className="eyebrow">炊飯器選び診断</p>
      <h1>
        あなたに合った炊飯器を、
        <br />
        数分で見つける。
      </h1>
      <p className="lead">
        家族の人数・使い方・予算の3つを答えると、 いまの暮らしに合う炊飯器をランキングで紹介します。
      </p>
      <ul className="benefits">
        {BENEFITS.map((b) => (
          <li key={b.title}>
            <strong>{b.title}</strong>
            <span>{b.text}</span>
          </li>
        ))}
      </ul>
      <button className="btn-primary" onClick={onStart} type="button">
        診断をはじめる
      </button>
      <p className="note">比較は各メーカー公式サイトの公開スペックに基づきます。価格は目安です。</p>
    </div>
  );
}
