// Talks to the server. Every request sends/receives JSON and the login cookie is sent automatically.
const Api = (() => {
  async function req(method, url, body) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: body !== undefined ? { "Content-Type": "application/json" } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
        credentials: "same-origin",
      });
    } catch {
      throw new Error("Cannot reach the server. Check your internet connection and try again.");
    }
    let data = null;
    try { data = await res.json(); } catch {}
    if (res.status === 401 && !/^\/api\/(login|register|me)$/.test(url)) { location.replace("login.html"); }
    if (!res.ok) throw new Error((data && data.error) || "Something went wrong. Please try again.");
    return data;
  }
  return {
    get: url => req("GET", url),
    post: (url, body = {}) => req("POST", url, body),
    patch: (url, body) => req("PATCH", url, body),
    del: url => req("DELETE", url),
  };
})();
