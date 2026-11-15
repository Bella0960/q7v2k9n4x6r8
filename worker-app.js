export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // With html_handling="none", explicitly map the site root to the built desktop.
    if (url.pathname === "/" && request.method === "GET") {
      const indexUrl = new URL("/index.html", url);
      return env.ASSETS.fetch(new Request(indexUrl, request));
    }

    // Preserve explicit .html app routes and all normal static asset requests.
    return env.ASSETS.fetch(request);
  }
};
