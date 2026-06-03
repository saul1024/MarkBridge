export function normalizeUrl(url) {
  const input = String(url ?? "").trim();

  if (!input) {
    return "";
  }

  try {
    const parsed = new URL(input);
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = "";

    if (parsed.pathname.length > 1) {
      parsed.pathname = parsed.pathname.replace(/\/+$/g, "") || "/";
    }

    return parsed.toString();
  } catch {
    return input.replace(/#.*$/u, "").replace(/\/+$/u, "");
  }
}
