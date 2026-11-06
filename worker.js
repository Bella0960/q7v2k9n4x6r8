export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Serve the actual desktop document at the origin root without changing
    // the browser URL or enabling a broad SPA fallback for missing app routes.
    if (url.pathname === "/" && (request.method === "GET" || request.method === "HEAD")) {
      const indexUrl = new URL("/index.html", url);
      return env.ASSETS.fetch(new Request(indexUrl, request));
    }

    // Keep explicit multi-page app URLs (including their .html suffixes)
    // unchanged; missing routes remain real 404 responses.
    return env.ASSETS.fetch(request);
  }
};
