const CANONICAL_ORIGIN = "https://pitariko.pages.dev";

export function canonicalUrl(pathname: string, origin = CANONICAL_ORIGIN): string {
  const path = pathname === "/" ? "/" : `/${pathname.replace(/^\/+|\/+$/g, "")}`;
  return new URL(path, `${origin}/`).toString();
}

export function syncCanonicalUrl(
  location: Pick<Location, "pathname" | "origin"> = window.location
): void {
  const url = canonicalUrl(location.pathname, location.origin);
  let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.rel = "canonical";
    document.head.appendChild(canonical);
  }
  canonical.href = url;

  let ogUrl = document.querySelector<HTMLMetaElement>('meta[property="og:url"]');
  if (!ogUrl) {
    ogUrl = document.createElement("meta");
    ogUrl.setAttribute("property", "og:url");
    document.head.appendChild(ogUrl);
  }
  ogUrl.content = url;
}
