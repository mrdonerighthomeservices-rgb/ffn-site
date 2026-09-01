// =====================================================================
// FFN — the whole back end, in one file.
//
// This single file replaces what used to be seven separate files inside a
// netlify/functions folder. It was combined so the site could be uploaded
// from an iPad, which cannot upload folders. Nothing about how it works
// changed; the endpoints are just routed inside here instead of by
// filename.
//
// After this file is uploaded, it must be renamed to
//   netlify/functions/api.js
// on GitHub (typing that path into the filename box creates the folders).
//
// Endpoints, all under /api/ :
//   GET  /api/jokes         public — approved joke bank + today's pick
//   POST /api/submit-joke   public — save a submission as 'pending'
//   GET  /api/admin-jokes   Jonny only — list pending submissions
//   POST /api/admin-jokes   Jonny only — approve or reject one
//   POST /api/signup        create a real member account, set session
//   POST /api/login         log an existing member in, set session
//   GET  /api/logout        clear the session cookie
//   GET  /api/whoami        is THIS browser really logged in? yes/no
//
// Two environment variables are required, set in Netlify (Site
// configuration > Environment variables), never in this file:
//   FFN_ADMIN_KEY       the passphrase that unlocks admin-jokes.html
//   FFN_SESSION_SECRET  a long random string used to sign login sessions
// =====================================================================
import { getDatabase } from "@netlify/database";
import crypto from "node:crypto";

export const config = { path: "/api/*" };

const ROTATION_PERIOD = "day"; // "day" or "week" — change this one line to switch

// ---------------------------------------------------------------------
// Schema. There is no migrations folder any more (folders again), so the
// tables are created on first use instead. CREATE TABLE IF NOT EXISTS is
// safe to run on every cold start; it does nothing once the tables exist.
// ---------------------------------------------------------------------
const SEED_JOKES = [
  ["Why did the angler bring string cheese to the lake?", "In case he needed to reel it in."],
  ["What do you call a fish that needs help with his vocals?", "Auto-tuna."],
  ["Why are fish so easy to weigh?", "They have their own scales."],
  ["What did the fisherman say to the magician?", "Pick a cod, any cod."],
  ["Why did the fish blush?", "Because it saw the ocean's bottom."],
  ["What is a fish's favorite instrument?", "The bass."],
  ["How do fish stay in touch?", "They use a shell phone, or they just drop a line."],
  ["Why do fishermen make bad campers?", "They always cast their tents in the wrong spot."],
  ["What kind of fish goes well with peanut butter?", "Jellyfish."],
  ["Why was the fisherman's wallet always empty?", "He kept throwing his cash back."],
  ["What do you call two fish that finish each other's sentences?", "Sole mates."],
  ["Why did the trout refuse to play cards?", "He was afraid of the net gain."],
  ["What is a lake's favorite kind of music?", "Anything with a good current."],
  ["Why did the camper bring a ladder into the woods?", "He heard the trail markers were pretty high up."],
];

let schemaReady = null;

async function ensureSchema(db) {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await db.sql`
      CREATE TABLE IF NOT EXISTS jokes (
        id SERIAL PRIMARY KEY,
        setup TEXT NOT NULL,
        punchline TEXT NOT NULL,
        submitter TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        reviewed_at TIMESTAMP
      )
    `;
    await db.sql`CREATE INDEX IF NOT EXISTS jokes_status_idx ON jokes (status)`;

    // Anyone under 13 is NEVER created in this table. That path stays the
    // parent/guardian lead form on join.html, which creates no account and
    // collects nothing about the child. COPPA — do not relax this.
    await db.sql`
      CREATE TABLE IF NOT EXISTS members (
        id SERIAL PRIMARY KEY,
        account_type TEXT NOT NULL DEFAULT 'adult',
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        dob DATE,
        town_or_county TEXT,
        phone TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `;
    await db.sql`CREATE UNIQUE INDEX IF NOT EXISTS members_email_idx ON members (lower(email))`;

    // Seed the starter jokes once, only if the bank is completely empty.
    const existing = await db.sql`SELECT COUNT(*)::int AS n FROM jokes`;
    if (!existing[0] || existing[0].n === 0) {
      for (const [setup, punchline] of SEED_JOKES) {
        await db.sql`
          INSERT INTO jokes (setup, punchline, submitter, status, reviewed_at)
          VALUES (${setup}, ${punchline}, 'FFN', 'approved', NOW())
        `;
      }
    }
  })().catch((err) => {
    schemaReady = null; // let a later request try again
    throw err;
  });
  return schemaReady;
}

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------
function json(status, obj, extraHeaders) {
  const headers = new Headers({ "content-type": "application/json" });
  if (extraHeaders) for (const [k, v] of extraHeaders) headers.append(k, v);
  return new Response(JSON.stringify(obj), { status, headers });
}

async function readJson(req) {
  try {
    return await req.json();
  } catch (e) {
    return null;
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = (stored || "").split(":");
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(check, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function buildSessionCookie(id) {
  const secret = process.env.FFN_SESSION_SECRET || "";
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 30; // 30 days
  const payload = `${id}.${exp}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `ffn_session=${payload}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;
}

function parseCookies(header) {
  const out = {};
  (header || "").split(";").forEach((p) => {
    const idx = p.indexOf("=");
    if (idx === -1) return;
    out[p.slice(0, idx).trim()] = decodeURIComponent(p.slice(idx + 1).trim());
  });
  return out;
}

function verifySession(cookieVal) {
  const secret = process.env.FFN_SESSION_SECRET || "";
  if (!cookieVal || !secret) return null;
  const parts = cookieVal.split(".");
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts;
  const expected = crypto.createHmac("sha256", secret).update(`${id}.${exp}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  if (Date.now() > parseInt(exp, 10)) return null;
  const idNum = parseInt(id, 10);
  return isNaN(idNum) ? null : idNum;
}

function ageFrom(dobStr) {
  const d = new Date(dobStr);
  if (isNaN(d.getTime())) return null;
  const t = new Date();
  let a = t.getFullYear() - d.getFullYear();
  const m = t.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < d.getDate())) a--;
  return a;
}

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
}

function rotationIndex(period, len) {
  if (len === 0) return 0;
  const now = new Date();
  return (period === "week" ? isoWeek(now) : now.getDate()) % len;
}

// ---------------------------------------------------------------------
// Endpoint handlers
// ---------------------------------------------------------------------
async function handleJokes(req, db) {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const rows = await db.sql`
    SELECT id, setup, punchline FROM jokes WHERE status = 'approved' ORDER BY id ASC
  `;
  const idx = rotationIndex(ROTATION_PERIOD, rows.length);
  return json(200, {
    period: ROTATION_PERIOD,
    featured: rows.length ? rows[idx] : null,
    bank: rows,
    total: rows.length,
  });
}

const MAX_LEN = 300;

async function handleSubmitJoke(req, db) {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await readJson(req);
  if (!body) return json(400, { error: "Bad request." });

  const setup = (body.setup || "").toString().trim();
  const punchline = (body.punchline || "").toString().trim();
  const submitter = (body.submitter || "").toString().trim().slice(0, 100);

  if (!setup || !punchline || setup.length > MAX_LEN || punchline.length > MAX_LEN) {
    return json(400, { error: "A setup and a punchline are both required." });
  }
  // Honeypot: bots fill hidden fields, people don't. Pretend it worked.
  if (body.jbotfield) return json(200, { ok: true });

  await db.sql`
    INSERT INTO jokes (setup, punchline, submitter, status)
    VALUES (${setup}, ${punchline}, ${submitter || null}, 'pending')
  `;
  return json(200, { ok: true });
}

async function handleAdminJokes(req, db) {
  const adminKey = process.env.FFN_ADMIN_KEY;
  const supplied = req.headers.get("x-admin-key") || "";
  if (!adminKey || supplied !== adminKey) {
    return json(401, { error: "Not authorized." });
  }

  if (req.method === "GET") {
    const rows = await db.sql`
      SELECT id, setup, punchline, submitter, created_at
      FROM jokes WHERE status = 'pending' ORDER BY created_at ASC
    `;
    return json(200, { pending: rows });
  }

  if (req.method === "POST") {
    const body = await readJson(req);
    if (!body) return json(400, { error: "Bad request." });
    const id = parseInt(body.id, 10);
    const action = body.action;
    if (!id || !["approve", "reject"].includes(action)) {
      return json(400, { error: "Need an id and approve/reject." });
    }
    const status = action === "approve" ? "approved" : "rejected";
    await db.sql`UPDATE jokes SET status = ${status}, reviewed_at = NOW() WHERE id = ${id}`;
    return json(200, { ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
}

async function handleSignup(req, db) {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await readJson(req);
  if (!body) return json(400, { error: "Bad request." });

  const name = (body.name || "").toString().trim().slice(0, 100);
  const email = (body.email || "").toString().trim().toLowerCase().slice(0, 200);
  const password = (body.password || "").toString();
  const dob = (body.dob || "").toString();
  const area = (body.area || "").toString().trim().slice(0, 100);
  const phone = (body.phone || "").toString().trim().slice(0, 40);
  const accountType = body.account_type === "youth" ? "youth" : "adult";

  if (!name || !email || !password) {
    return json(400, { error: "Name, email, and password are all required." });
  }
  if (password.length < 8) {
    return json(400, { error: "Password needs to be at least 8 characters." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(400, { error: "That email doesn't look right." });
  }

  // Server-side age check. The browser's age gate on join.html can be
  // bypassed; this cannot. Never relax it.
  if (dob) {
    const age = ageFrom(dob);
    if (age !== null && age < 13) {
      return json(403, {
        error:
          "Accounts for anyone under 13 are not created this way. Use the parent/guardian form on the Join page instead.",
      });
    }
  }

  const existing = await db.sql`SELECT id FROM members WHERE lower(email) = ${email}`;
  if (existing.length) {
    return json(409, { error: "An account already exists for that email. Try logging in instead." });
  }

  const hash = hashPassword(password);
  const rows = await db.sql`
    INSERT INTO members (account_type, name, email, password_hash, dob, town_or_county, phone)
    VALUES (${accountType}, ${name}, ${email}, ${hash}, ${dob || null}, ${area || null}, ${phone || null})
    RETURNING id, name, account_type
  `;
  const member = rows[0];
  return json(200, { ok: true, name: member.name, account_type: member.account_type }, [
    ["set-cookie", buildSessionCookie(member.id)],
  ]);
}

async function handleLogin(req, db) {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await readJson(req);
  if (!body) return json(400, { error: "Bad request." });

  const email = (body.email || "").toString().trim().toLowerCase();
  const password = (body.password || "").toString();
  if (!email || !password) return json(400, { error: "Email and password are both required." });

  const rows = await db.sql`
    SELECT id, name, account_type, password_hash FROM members WHERE lower(email) = ${email}
  `;
  const member = rows[0];
  // Same message either way, so a wrong guess can't reveal whether the
  // email exists.
  if (!member || !verifyPassword(password, member.password_hash)) {
    return json(401, { error: "Email or password did not match." });
  }
  return json(200, { ok: true, name: member.name, account_type: member.account_type }, [
    ["set-cookie", buildSessionCookie(member.id)],
  ]);
}

function handleLogout() {
  return json(200, { ok: true }, [
    ["set-cookie", "ffn_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"],
  ]);
}

async function handleWhoami(req, db) {
  const cookies = parseCookies(req.headers.get("cookie"));
  const memberId = verifySession(cookies.ffn_session);
  if (!memberId) return json(200, { member: false });
  const rows = await db.sql`SELECT id, name, account_type FROM members WHERE id = ${memberId}`;
  if (!rows.length) return json(200, { member: false });
  return json(200, { member: true, name: rows[0].name, account_type: rows[0].account_type });
}

// ---------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------
export default async (req) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  const action = path.split("/").pop();

  // Logout needs no database at all — sessions are signed cookies, not rows.
  if (action === "logout") return handleLogout();

  let db;
  try {
    db = getDatabase();
    await ensureSchema(db);
  } catch (err) {
    console.error("FFN database unavailable:", err);
    // whoami must never break a page; it just answers "not logged in".
    if (action === "whoami") return json(200, { member: false });
    return json(500, { error: "The site's database is not reachable right now." });
  }

  try {
    switch (action) {
      case "jokes":
        return await handleJokes(req, db);
      case "submit-joke":
        return await handleSubmitJoke(req, db);
      case "admin-jokes":
        return await handleAdminJokes(req, db);
      case "signup":
        return await handleSignup(req, db);
      case "login":
        return await handleLogin(req, db);
      case "whoami":
        return await handleWhoami(req, db);
      default:
        return json(404, { error: "No such endpoint." });
    }
  } catch (err) {
    console.error(`FFN /api/${action} error:`, err);
    if (action === "whoami") return json(200, { member: false }); // fail closed, never break a page
    return json(500, { error: "Something went wrong on our end. Try again in a bit." });
  }
};
