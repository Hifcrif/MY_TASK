"use strict";
// The JSON API (/api/...): accounts, tasks and weekly classes.
// Runs as a Vercel Function (api/index.js) and also locally (server.js).
// Uses only Node's built-in modules plus "pg" (the Postgres driver).
const crypto = require("crypto");
const { promisify } = require("util");
const db = require("./db");

const scrypt = promisify(crypto.scrypt);
const PROD = process.env.NODE_ENV === "production" || ["production", "preview"].includes(process.env.VERCEL_ENV);
const COOKIE = PROD ? "__Host-sid" : "sid";
const DAY = 24 * 60 * 60 * 1000;
const MAX_TASKS = 500, MAX_SCHEDULES = 300;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* ---------------------------------------------------------------- passwords */
// Passwords are never stored: only a salted scrypt hash.
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), key.toString("base64")].join("$");
}
async function verifyPassword(password, stored) {
  const [alg, N, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(hash, "base64");
  const key = await scrypt(password, Buffer.from(salt, "base64"), expected.length, { N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem });
  return crypto.timingSafeEqual(key, expected);
}
let dummyHash = null; // so unknown usernames take as long as real ones
const getDummyHash = () => dummyHash || (dummyHash = hashPassword("not-a-real-password"));

/* ------------------------------------------------------------ rate limiting */
// Counters live in the database, because serverless functions do not share memory.
async function addHit(key, windowMs) {
  const { rows } = await db.query(
    `INSERT INTO rate_limits (k, hits, reset_at) VALUES ($1::text, 1, $2::timestamptz)
     ON CONFLICT (k) DO UPDATE SET
       hits = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.hits + 1 END,
       reset_at = CASE WHEN rate_limits.reset_at <= now() THEN $2::timestamptz ELSE rate_limits.reset_at END
     RETURNING hits`,
    [key, new Date(Date.now() + windowMs).toISOString()]);
  return Number(rows[0].hits);
}
async function getHits(key) {
  const { rows } = await db.query("SELECT hits FROM rate_limits WHERE k = $1::text AND reset_at > now()", [key]);
  return rows.length ? Number(rows[0].hits) : 0;
}
const clearHits = key => db.query("DELETE FROM rate_limits WHERE k = $1::text", [key]);
async function limit(key, max, windowMs) {
  if (await addHit(key, windowMs) > max) throw new HttpError(429, "Too many attempts. Please wait a few minutes and try again.");
}

// On Vercel the visitor's address comes from a header Vercel sets itself.
function clientIp(req) {
  if (process.env.VERCEL && req.headers["x-real-ip"]) return String(req.headers["x-real-ip"]);
  const hops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  const xff = String(req.headers["x-forwarded-for"] || "").split(",").map(s => s.trim()).filter(Boolean);
  if (hops > 0 && xff.length) return xff[Math.max(0, xff.length - hops)];
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

/* ----------------------------------------------------------------- sessions */
const sha = t => crypto.createHash("sha256").update(t).digest("hex");

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
function setCookie(res, value, maxAgeSec) {
  const parts = [`${COOKIE}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (PROD) parts.push("Secure");
  if (maxAgeSec !== undefined) parts.push(`Max-Age=${maxAgeSec}`);
  res.setHeader("Set-Cookie", parts.join("; "));
}
async function startSession(res, userId, keep) {
  const token = crypto.randomBytes(32).toString("base64url");
  const ttl = keep ? 30 * DAY : DAY;
  await db.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2::bigint, $3::timestamptz)",
    [sha(token), userId, new Date(Date.now() + ttl).toISOString()]);
  setCookie(res, token, keep ? ttl / 1000 : undefined); // no Max-Age = ends when the browser closes
}
async function getUser(req) {
  if (req.user !== undefined) return req.user;
  const token = parseCookies(req)[COOKIE];
  req.user = null;
  if (token && token.length < 100) {
    const { rows } = await db.query(
      "SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()",
      [sha(token)]);
    req.user = rows[0] || null;
  }
  return req.user;
}

/* --------------------------------------------------------------- validation */
const USERNAME_RE = /^[A-Za-z0-9._-]{3,20}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const PRIOS = ["low", "medium", "high"];
const CATS = ["main", "study", "special", "break"];
const bad = msg => new HttpError(400, msg);

function text(v, label, min, max) {
  const s = typeof v === "string" ? v.trim() : "";
  if (s.length < min) throw bad(`${label} is required.`);
  if (s.length > max) throw bad(`${label} must be at most ${max} characters.`);
  return s;
}
function dueDate(v) {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw bad("Due date is not valid.");
  return v;
}
const toMin = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

/* ------------------------------------------------------------------ outputs */
const TASK_COLS = "id, title, due, prio, done";
const SCHED_COLS = "id, title, day, start_time, end_time, cat, notes, task_id";
const taskOut = r => ({ id: r.id, title: r.title, due: r.due, prio: r.prio, done: r.done });
const schedOut = r => ({ id: r.id, title: r.title, day: Number(r.day), start: r.start_time, end: r.end_time, cat: r.cat, notes: r.notes, taskId: r.task_id || "" });

/* ----------------------------------------------------------------- handlers */
async function register({ req, res, body }) {
  await limit(`reg:${clientIp(req)}`, 10, 60 * 60 * 1000);
  const username = typeof body.username === "string" ? body.username.trim() : "";
  if (!USERNAME_RE.test(username)) throw bad("Username must be 3–20 characters: letters, numbers, dot, dash or underscore.");
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 8) throw bad("Password must be at least 8 characters.");
  if (password.length > 200) throw bad("Password must be at most 200 characters.");
  const hash = await hashPassword(password);
  let user;
  try {
    ({ rows: [user] } = await db.query(
      "INSERT INTO users (username, username_lower, password_hash) VALUES ($1, $2, $3) RETURNING id, username",
      [username, username.toLowerCase(), hash]));
  } catch (e) {
    if (e.code === "23505") throw new HttpError(409, "That username is already taken.");
    throw e;
  }
  await startSession(res, user.id, !!body.keep);
  return { username: user.username };
}

async function login({ req, res, body }) {
  const WINDOW = 15 * 60 * 1000;
  await limit(`auth:${clientIp(req)}`, 30, WINDOW);
  const id = String(body.username || "").trim().toLowerCase().slice(0, 50);
  const password = typeof body.password === "string" ? body.password.slice(0, 200) : "";
  const failKey = `fail:${id}`;
  if (await getHits(failKey) >= 10) throw new HttpError(429, "Too many failed attempts. Please wait a few minutes and try again.");
  const { rows: [u] } = await db.query("SELECT id, username, password_hash FROM users WHERE username_lower = $1", [id]);
  const ok = await verifyPassword(password, u ? u.password_hash : await getDummyHash());
  if (!u || !ok) { await addHit(failKey, WINDOW); throw new HttpError(401, "Wrong username or password."); }
  await clearHits(failKey);
  await startSession(res, u.id, !!body.keep);
  return { username: u.username };
}

async function logout({ req, res }) {
  const token = parseCookies(req)[COOKIE];
  if (token && token.length < 100) await db.query("DELETE FROM sessions WHERE token_hash = $1", [sha(token)]);
  setCookie(res, "", 0);
  return { ok: true };
}

const me = ({ user }) => ({ username: user.username });

async function getData({ user }) {
  const [t, s] = await Promise.all([
    db.query(`SELECT ${TASK_COLS} FROM tasks WHERE user_id = $1::bigint ORDER BY created_at`, [user.id]),
    db.query(`SELECT ${SCHED_COLS} FROM schedules WHERE user_id = $1::bigint ORDER BY day, start_time`, [user.id]),
  ]);
  return { tasks: t.rows.map(taskOut), schedules: s.rows.map(schedOut) };
}

async function createTask(ctx) {
  const { user, body } = ctx;
  const title = text(body.title, "Task", 1, 200);
  const due = dueDate(body.due);
  const prio = body.prio === undefined ? "medium" : body.prio;
  if (!PRIOS.includes(prio)) throw bad("Priority is not valid.");
  const { rows } = await db.query(
    `INSERT INTO tasks (id, user_id, title, due, prio)
     SELECT $1::uuid, $2::bigint, $3::text, $4::text, $5::text
     WHERE (SELECT count(*) FROM tasks WHERE user_id = $2::bigint) < ${MAX_TASKS}
     RETURNING ${TASK_COLS}`,
    [crypto.randomUUID(), user.id, title, due, prio]);
  if (!rows.length) throw new HttpError(409, `You can have at most ${MAX_TASKS} tasks.`);
  ctx.status = 201;
  return taskOut(rows[0]);
}

async function updateTask({ user, body, params }) {
  if (!UUID_RE.test(params.id)) throw new HttpError(404, "Task not found.");
  const sets = [], vals = [params.id, user.id];
  const add = (col, cast, v) => { vals.push(v); sets.push(`${col} = $${vals.length}::${cast}`); };
  if (body.done !== undefined) { if (typeof body.done !== "boolean") throw bad("Done must be true or false."); add("done", "boolean", body.done); }
  if (body.title !== undefined) add("title", "text", text(body.title, "Task", 1, 200));
  if (body.due !== undefined) add("due", "text", dueDate(body.due));
  if (body.prio !== undefined) { if (!PRIOS.includes(body.prio)) throw bad("Priority is not valid."); add("prio", "text", body.prio); }
  if (!sets.length) throw bad("Nothing to update.");
  const { rows } = await db.query(
    `UPDATE tasks SET ${sets.join(", ")} WHERE id = $1::uuid AND user_id = $2::bigint RETURNING ${TASK_COLS}`, vals);
  if (!rows.length) throw new HttpError(404, "Task not found.");
  return taskOut(rows[0]);
}

async function deleteTask({ user, params }) {
  if (!UUID_RE.test(params.id)) throw new HttpError(404, "Task not found.");
  const { rows } = await db.query("DELETE FROM tasks WHERE id = $1::uuid AND user_id = $2::bigint RETURNING id", [params.id, user.id]);
  if (!rows.length) throw new HttpError(404, "Task not found.");
  return { ok: true };
}

async function createSchedule(ctx) {
  const { user, body } = ctx;
  const title = text(body.title, "Class / activity", 1, 100);
  const day = body.day;
  if (!Number.isInteger(day) || day < 0 || day > 6) throw bad("Day is not valid.");
  const { start, end } = body;
  if (!TIME_RE.test(start) || !TIME_RE.test(end)) throw bad("Start and end time are required.");
  if (toMin(end) <= toMin(start)) throw bad("End time must be after start time.");
  const cat = body.cat === undefined ? "main" : body.cat;
  if (!CATS.includes(cat)) throw bad("Type is not valid.");
  const notes = body.notes === undefined || body.notes === null ? "" : text(body.notes, "Notes", 0, 200);
  let taskId = null;
  if (body.taskId) {
    if (typeof body.taskId !== "string" || !UUID_RE.test(body.taskId)) throw bad("Linked task not found.");
    const own = await db.query("SELECT id FROM tasks WHERE id = $1::uuid AND user_id = $2::bigint", [body.taskId, user.id]);
    if (!own.rows.length) throw bad("Linked task not found.");
    taskId = body.taskId;
  }
  const { rows } = await db.query(
    `INSERT INTO schedules (id, user_id, title, day, start_time, end_time, cat, notes, task_id)
     SELECT $1::uuid, $2::bigint, $3::text, $4::smallint, $5::text, $6::text, $7::text, $8::text, $9::uuid
     WHERE (SELECT count(*) FROM schedules WHERE user_id = $2::bigint) < ${MAX_SCHEDULES}
     RETURNING ${SCHED_COLS}`,
    [crypto.randomUUID(), user.id, title, day, start, end, cat, notes, taskId]);
  if (!rows.length) throw new HttpError(409, `You can have at most ${MAX_SCHEDULES} classes.`);
  ctx.status = 201;
  return schedOut(rows[0]);
}

async function deleteSchedule({ user, params }) {
  if (!UUID_RE.test(params.id)) throw new HttpError(404, "Class not found.");
  const { rows } = await db.query("DELETE FROM schedules WHERE id = $1::uuid AND user_id = $2::bigint RETURNING id", [params.id, user.id]);
  if (!rows.length) throw new HttpError(404, "Class not found.");
  return { ok: true };
}

// [method, path, handler, needs login?, reads a JSON body?]
const API = [
  ["POST",   "/api/register",      register,       false, true],
  ["POST",   "/api/login",         login,          false, true],
  ["POST",   "/api/logout",        logout,         false, true],
  ["GET",    "/api/me",            me,             true,  false],
  ["GET",    "/api/data",          getData,        true,  false],
  ["POST",   "/api/tasks",         createTask,     true,  true],
  ["PATCH",  "/api/tasks/:id",     updateTask,     true,  true],
  ["DELETE", "/api/tasks/:id",     deleteTask,     true,  false],
  ["POST",   "/api/schedules",     createSchedule, true,  true],
  ["DELETE", "/api/schedules/:id", deleteSchedule, true,  false],
].map(([method, p, fn, auth, hasBody]) =>
  ({ method, re: new RegExp("^" + p.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"), fn, auth, hasBody }));

/* ------------------------------------------------------------------ plumbing */
function parseBody(v) {
  if (Buffer.isBuffer(v)) v = v.toString("utf8");
  if (typeof v === "string") { try { v = JSON.parse(v || "{}"); } catch { throw new HttpError(400, "Invalid JSON."); } }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new HttpError(400, "Invalid JSON.");
  return v;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json/i.test(req.headers["content-type"] || "")) return reject(new HttpError(415, "Send JSON."));
    if (Number(req.headers["content-length"] || 0) > 20000) return reject(new HttpError(413, "Request too large."));
    // Vercel may already have read and parsed the body for us; a plain Node server has not.
    let pre;
    try { pre = req.body; } catch { return reject(new HttpError(400, "Invalid JSON.")); }
    if (pre !== undefined) { try { return resolve(parseBody(pre)); } catch (e) { return reject(e); } }
    const chunks = []; let size = 0;
    req.on("data", c => { size += c.length; if (size > 20000) { reject(new HttpError(413, "Request too large.")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(parseBody(Buffer.concat(chunks))); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

// A browser always sends Origin on cross-site POST/PATCH/DELETE; refuse if it is not this site.
function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  let host = null;
  try { host = new URL(origin).host; } catch {}
  if (host !== req.headers.host) throw new HttpError(403, "Request blocked.");
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" });
  res.end(body);
}

function securityHeaders(res) {
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
    "connect-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  ].join("; "));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (PROD) res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
}

// Now and then, remove expired sessions and rate-limit counters.
async function maybeCleanup() {
  if (Math.random() > 0.02) return;
  try {
    await db.query("DELETE FROM sessions WHERE expires_at < now()");
    await db.query("DELETE FROM rate_limits WHERE reset_at < now()");
  } catch {}
}

async function route(req, res, pathname) {
  const found = API.find(r => r.method === req.method && r.re.test(pathname));
  if (!found) {
    if (API.some(r => r.re.test(pathname))) throw new HttpError(405, "Method not allowed.");
    throw new HttpError(404, "Not found.");
  }
  if (req.method !== "GET") checkOrigin(req);
  await db.ready();
  const user = await getUser(req);
  if (found.auth && !user) throw new HttpError(401, "Please log in.");
  const body = found.hasBody ? await readJson(req) : {};
  const ctx = { req, res, user, body, params: pathname.match(found.re).groups || {}, status: 200 };
  const data = await found.fn(ctx);
  sendJson(res, ctx.status, data);
  await maybeCleanup();
}

async function handler(req, res) {
  securityHeaders(res);
  try {
    const url = new URL(req.url, "http://localhost");
    let pathname = url.pathname.replace(/\/+$/, "") || "/";
    // If the host rewrote /api/x to /api, the original path arrives in ?path=x
    if (/^\/api(\/index(\.js)?)?$/.test(pathname) && url.searchParams.has("path")) pathname = "/api/" + url.searchParams.get("path");
    if (pathname === "/api/health") return sendJson(res, 200, { ok: true });
    if (!pathname.startsWith("/api/")) throw new HttpError(404, "Not found.");
    await route(req, res, pathname);
  } catch (err) {
    let status = err.status || 500, message = err.message;
    if (err.code === "NO_DB") { status = 503; message = "The database is not connected yet. Connect a database to the project, then redeploy."; }
    else if (status === 500) { console.error("Server error:", err); message = "Something went wrong on the server."; }
    if (res.headersSent) return res.end();
    sendJson(res, status, { error: message });
  }
}

module.exports = handler;
module.exports.securityHeaders = securityHeaders;
