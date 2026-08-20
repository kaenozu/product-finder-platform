import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { BrandHome } from "./BrandHome";
import "./styles.css";

// URL分離: "/" = pitarikoポータル, "/rice-cooker" = 炊飯器診断。
// 未知パスはポータルへフォールバック（SPAフォールバックと合わせて安全側に倒す）。
function currentCategory(): string | null {
  const path = window.location.pathname;
  if (path === "/" || path === "") return null;
  const match = path.match(/^\/([a-z0-9-]+)\/?$/);
  if (!match) return null;
  return match[1] ?? null;
}

const categoryKey = currentCategory();

createRoot(document.getElementById("root")!).render(
  <StrictMode>{categoryKey ? <App categoryKey={categoryKey} /> : <BrandHome />}</StrictMode>
);
