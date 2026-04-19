import { useEffect, useState } from "preact/hooks";

interface Props { fortunes: string[] }

export default function Fortune({ fortunes }: Props) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    setIdx(Math.floor(Math.random() * fortunes.length));
  }, []);
  return (
    <>
      <div class="fortune-box">
        <div class="fortune-title">{"// "}fortune -s</div>
        <div class="fortune-text">{fortunes[idx]}</div>
      </div>
      <div class="actions">
        <a class="primary" onClick={() => setIdx((idx + 1) % fortunes.length)}>$ fortune</a>
        <a class="secondary" href="/">cd ~</a>
      </div>
    </>
  );
}
