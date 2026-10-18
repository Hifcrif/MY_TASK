// Accounts. The server checks passwords and remembers who is logged in (a secure cookie).
const Auth = {
  register: (username, password, keep) => Api.post("/api/register", { username, password, keep }),
  login: (username, password, keep) => Api.post("/api/login", { username, password, keep }),
  me: () => Api.get("/api/me").catch(() => null), // { username } or null when not logged in
  async logout() {
    try { await Api.post("/api/logout"); } catch {}
    location.replace("login.html");
  },
};
