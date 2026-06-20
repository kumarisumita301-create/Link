// api/shorten.js
// Vercel Serverless Function — public API endpoint to shorten links.
//
// Usage:
//   GET  /api/shorten?url=https://example.com&key=USER_API_KEY
//   POST /api/shorten   body: { "url": "https://example.com", "key": "USER_API_KEY" }
//
// Response:
//   { "success": true, "shortUrl": "https://yourapp.vercel.app/r.html?c=Ab12Cd" }
//   { "success": false, "error": "message" }

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";

// ---- Firebase Admin init (uses service account from env vars) ----
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
    databaseURL: "https://cheatera-e6f5d-default-rtdb.firebaseio.com",
  });
}
const db = getDatabase();

function generateCode(len = 6) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  for (let i = 0; i < len; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function isValidUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  // Allow simple CORS for external/script usage
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed. Use GET or POST." });
  }

  const params = req.method === "GET" ? req.query : (req.body || {});
  const { url, key } = params;

  if (!key) {
    return res.status(401).json({ success: false, error: "Missing API key." });
  }
  if (!url) {
    return res.status(400).json({ success: false, error: "Missing 'url' parameter." });
  }
  if (!isValidUrl(url)) {
    return res.status(400).json({ success: false, error: "Invalid URL. Must start with http:// or https://" });
  }

  try {
    // Validate API key
    const keySnap = await db.ref("apiKeys/" + key).get();
    if (!keySnap.exists() || keySnap.val().active === false) {
      return res.status(403).json({ success: false, error: "Invalid or inactive API key." });
    }

    // Generate unique short code
    let code = generateCode();
    let exists = (await db.ref("links/" + code).get()).exists();
    while (exists) {
      code = generateCode();
      exists = (await db.ref("links/" + code).get()).exists();
    }

    // Save link
    await db.ref("links/" + code).set({
      longUrl: url,
      createdAt: Date.now(),
      clicks: 0,
      earnings: 0,
      createdVia: "api",
      apiKeyUsed: key,
    });

    // Track usage on the key (count only, no limit enforced)
    await db.ref("apiKeys/" + key + "/totalRequests").transaction((v) => (v || 0) + 1);
    await db.ref("apiKeys/" + key + "/lastUsedAt").set(Date.now());

    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const shortUrl = `${protocol}://${host}/r.html?c=${code}`;

    return res.status(200).json({ success: true, shortUrl, code });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: "Internal server error." });
  }
}
