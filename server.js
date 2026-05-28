import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { Client, Databases, Query } from 'node-appwrite';
import crypto from 'crypto';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { getValidZohoToken } from './zohoTokenUtils.js';

dotenv.config();

const app = express();
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf } }));

// CORS and cookie SameSite configuration
const FRONTEND_BASE = process.env.FRONTEND_BASE_URL || '';
const BACKEND_BASE = process.env.BACKEND_BASE_URL || '';
// Determine if frontend and backend are on different origins.
// If FRONTEND_BASE is provided and differs from BACKEND_BASE, enable credentialed CORS.
const CROSS_ORIGIN = FRONTEND_BASE && FRONTEND_BASE !== '' && FRONTEND_BASE !== BACKEND_BASE;
const CORS_ORIGIN = CROSS_ORIGIN ? FRONTEND_BASE : '*';
app.use(cors({ origin: CORS_ORIGIN, credentials: CROSS_ORIGIN }));

// cookieSameSite to use when setting httpOnly cookies. For cross-origin flows we must use 'None'.
const COOKIE_SAMESITE = CROSS_ORIGIN ? 'None' : 'Lax';
// When SameSite=None is used, many browsers require Secure=true. Allow forcing Secure
// in development when using an HTTPS frontend (e.g., ngrok).
const COOKIE_SECURE = (process.env.NODE_ENV === 'production') || (COOKIE_SAMESITE === 'None');

// Lightweight cookie parsing middleware so we can read signupId without adding a dependency.
app.use((req, res, next) => {
  req.cookies = {};
  const raw = req.headers && req.headers.cookie;
  if (raw) {
    raw.split(';').forEach(pair => {
      const idx = pair.indexOf('=');
      if (idx > -1) {
        const key = pair.slice(0, idx).trim();
        const val = pair.slice(idx + 1).trim();
        try { req.cookies[key] = decodeURIComponent(val); } catch (e) { req.cookies[key] = val; }
      }
    });
  }
  next();
});

// Serve static frontend files from backend/public (so frontend and API share the same origin/port)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// serve landing page at root for convenience
app.get('/', (req, res) => {
  try {
    return res.sendFile(path.join(publicDir, 'ebookLandingPage.html'));
  } catch (err) {
    return res.status(500).send('Unable to load landing page');
  }
});

// Temporary debug route to inspect public directory
import fs from 'fs';
app.get('/api/_debug/public', (req, res) => {
  try {
    const files = fs.readdirSync(publicDir);
    return res.json({ publicDir, files });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// Get Paystack public key for inline payment
app.get('/api/paystack-public-key', (req, res) => {
  try {
    const publicKey = process.env.PAYSTACK_PUBLIC_KEY || '';
    if (!publicKey) {
      return res.status(500).json({ error: 'Paystack public key not configured' });
    }
    return res.json({ publicKey });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// Appwrite client
const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const databases = new Databases(client);

// Helper: safely fetch a document and return null when not found. Log only unexpected errors.
async function safeGetDocument(dbId, collectionId, id) {
  if (!id) return null;
  try {
    return await databases.getDocument(dbId, collectionId, id);
  } catch (e) {
    const msg = e && (e.message || e.toString && e.toString()) || '';
    if (String(msg).includes('Document with the requested ID')) {
      // not-found: expected in some flows; keep it silent to avoid noisy logs
    } else {
      console.warn('safeGetDocument unexpected error:', msg);
    }
    return null;
  }
}

// Normalize numeric timestamps that may be in seconds or milliseconds to milliseconds
function normalizeTimestampToMs(v) {
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  // If value looks like seconds (<= 10 digits), convert to ms
  if (n < 1e11) return n * 1000;
  return n;
}

// NOTE: per-email cooldowns removed. We still keep a daily quota guard to avoid
// hitting Zoho's free-plan request limit. If you need cooldowns again, reintroduce
// a shared store (Redis/Appwrite) for multi-instance safety.

// Zoho daily quota guard: free plan allows 1000 requests/day per organization.
// We track requests per UTC day in-memory and optionally persist a daily counter to Appwrite
// when ZOHO_QUOTA_DB and ZOHO_QUOTA_COLLECTION are configured.
const ZOHO_DAILY_QUOTA = Number(process.env.ZOHO_DAILY_QUOTA || 1000);
const ZOHO_QUOTA_DB = process.env.ZOHO_QUOTA_DB || null;
const ZOHO_QUOTA_COLLECTION = process.env.ZOHO_QUOTA_COLLECTION || null;

// in-memory daily counter: { date: 'YYYY-MM-DD', count: number }
let zohoDaily = { date: new Date().toISOString().slice(0,10), count: 0 };

async function persistZohoDaily(databases) {
  if (!ZOHO_QUOTA_DB || !ZOHO_QUOTA_COLLECTION || !databases) return;
  try {
    const docId = `zoho_quota_${zohoDaily.date}`;
    // try to get existing doc
    try {
      const existing = await databases.getDocument(ZOHO_QUOTA_DB, ZOHO_QUOTA_COLLECTION, docId);
      await databases.updateDocument(ZOHO_QUOTA_DB, ZOHO_QUOTA_COLLECTION, docId, { date: zohoDaily.date, count: zohoDaily.count });
    } catch (e) {
      // create if not found
      try {
        await databases.createDocument(ZOHO_QUOTA_DB, ZOHO_QUOTA_COLLECTION, docId, { date: zohoDaily.date, count: zohoDaily.count });
      } catch (e2) {
        // ignore persistence failure
        console.warn('persistZohoDaily: unable to persist quota to Appwrite (non-fatal):', e2.message || e2);
      }
    }
  } catch (e) {
    console.warn('persistZohoDaily: unexpected error (non-fatal):', e.message || e);
  }
}

function resetZohoDailyIfNeeded() {
  const today = new Date().toISOString().slice(0,10);
  if (zohoDaily.date !== today) {
    zohoDaily.date = today;
    zohoDaily.count = 0;
  }
}

// Offer window (minutes) used to decide which paid list to assign a buyer to when
// offerDeadline isn't present on the signup. Default 30 minutes; can be overridden
// via OFFER_WINDOW_MINUTES environment variable.
const OFFER_WINDOW_MINUTES = Number(process.env.OFFER_WINDOW_MINUTES || 30);
const OFFER_WINDOW_MS = Math.max(0, OFFER_WINDOW_MINUTES) * 60 * 1000;

// Function to determine which Zoho segmentation list to add buyer to based on upsells selected
// Returns a single list key (not array) based on which combination of upsells they bought
// Upsell IDs: 'vsl_course', 'offers_course', 'youtube_ads'
function getZohoSegmentationList(upsellsSelected) {
  // Parse if it's a JSON string
  let upsells = [];
  if (typeof upsellsSelected === 'string') {
    try {
      upsells = JSON.parse(upsellsSelected);
    } catch (e) {
      console.warn('Failed to parse upsellsSelected:', upsellsSelected);
      upsells = [];
    }
  } else if (Array.isArray(upsellsSelected)) {
    upsells = upsellsSelected;
  }
  
  const hasVSL = upsells.includes('vsl_course');
  const hasOffers = upsells.includes('offers_course');
  const hasYouTube = upsells.includes('youtube_ads');
  const count = upsells.length;
  
  // NO UPSELLS - Core only
  if (count === 0) {
    return process.env.BOUGHT_CORE_OFFER_ONLY_LIST_KEY || null;
  }
  
  // ONE UPSELL
  if (count === 1) {
    if (hasVSL) return process.env.BOUGHT_VSL_COURSE_ONLY_LIST_KEY || null;
    if (hasOffers) return process.env.BOUGHT_OFFERS_COURSE_ONLY_LIST_KEY || null;
    if (hasYouTube) return process.env.BOUGHT_YOUTUBE_ADS_ONLY_LIST_KEY || null;
  }
  
  // TWO UPSELLS
  if (count === 2) {
    if (hasVSL && hasOffers) return process.env.BOUGHT_VSL_AND_OFFERS_LIST_KEY || null;
    if (hasVSL && hasYouTube) return process.env.BOUGHT_VSL_AND_YOUTUBE_LIST_KEY || null;
    if (hasOffers && hasYouTube) return process.env.BOUGHT_OFFERS_AND_YOUTUBE_LIST_KEY || null;
  }
  
  // ALL THREE UPSELLS
  if (count === 3 && hasVSL && hasOffers && hasYouTube) {
    return process.env.BOUGHT_ALL_UPSELLS_LIST_KEY || null;
  }
  
  // Unrecognized combination
  console.warn('Unrecognized upsell combination:', upsells);
  return null;
}


// Database/collection ids (provide via .env)
const ORDERS_DB = process.env.ORDERS_DATABASE_ID || 'ordersDB';
const ORDERS_COLLECTION = process.env.ORDERS_COLLECTION_ID;
const SIGNUPS_DB = process.env.SIGNUPS_DATABASE_ID || 'sign_ups';
const SIGNUPS_COLLECTION = process.env.SIGNUPS_COLLECTION_ID;

// POST /api/initiate-payment
// simple email validator (basic, permissive)
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  // simple regex: something@something.tld (allows + and subdomains)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// POST /api/initiate-payment
app.post('/api/initiate-payment', async (req, res) => {
  try {
    console.log('/api/initiate-payment incoming body:', req.body);
    // accept only name/email/phone from the frontend; city/state/amount are optional
  const { name, email, phone } = req.body || {};
    const city = req.body && req.body.city ? req.body.city : '';
    const state = req.body && req.body.state ? req.body.state : '';
    // amount may be omitted by the client; use a DEFAULT_PRICE env var or fallback to 49
    const amount = (typeof req.body?.amount !== 'undefined' && req.body.amount !== null)
      ? Number(req.body.amount)
    // DEFAULT_PRICE is specified in USD; multiply by 100 later to convert to cents for Paystack
    : Number(process.env.DEFAULT_PRICE || 97);

    if (!name || !email) return res.status(400).json({ error: 'Missing name or email' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email address' });
  // phone is optional; if present, do a light validation
  if (phone && !/^[0-9+\-().\s]{7,30}$/.test(phone)) return res.status(400).json({ error: 'Invalid phone' });

    // 1) Determine signup (if present) so we can compute timing from the signup record
  // Prefer signupId from body but fall back to cookie if present so the frontend doesn't need to store/send it.
  const signupId = (req.body && req.body.signupId) ? req.body.signupId : (req.cookies && req.cookies.signupId ? req.cookies.signupId : null);
    let signup = null;
    try {
      if (signupId && SIGNUPS_COLLECTION) {
        signup = await safeGetDocument(SIGNUPS_DB, SIGNUPS_COLLECTION, signupId);
      } else if (email && SIGNUPS_COLLECTION) {
        try {
          const found = await databases.listDocuments(SIGNUPS_DB, SIGNUPS_COLLECTION, [ Query.equal('email', email) ]);
          if (found && found.documents && found.documents.length) signup = found.documents[0];
        } catch (e) {
          console.warn('/api/initiate-payment: signup email lookup failed (non-fatal):', e.message || e);
        }
      }
      
      console.log('/api/initiate-payment signup record found:', !!signup, signup && { id: signup.$id, email: signup.email, pageEnterAt: signup.pageEnterAt });
    } catch (e) {
      console.warn('Unable to load signup record (non-fatal):', e.message || e);
      signup = null;
    }

    // compute timing-related values from signup when possible (we no longer use eligibility by time)
    const createdAt = new Date().toISOString();
    let timeSpentBeforeInitiateMs = null;
    if (signup && signup.pageEnterAt) {
      timeSpentBeforeInitiateMs = Date.now() - Number(signup.pageEnterAt);
    }

    // 1) Initialize Paystack transaction first (do NOT put timing into metadata)
    const paystackBody = {
      email,
      amount: Math.round(Number(amount) * 100),
      callback_url: process.env.PAYSTACK_CALLBACK_URL,
      metadata: {
        name,
        phone,
        signupId: signup ? signup.$id : undefined
      },
    };

    const initResp = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(paystackBody)
    });

    const initText = await initResp.text();
    let initData = null;
    try { initData = JSON.parse(initText); } catch(e) { initData = initText; }
    console.log('[initiate-payment] Paystack init response:', { status: initResp.status, data: initData });
    if (!initResp.ok || !(initData && initData.status)) {
      console.error('Paystack init failed', { status: initResp.status, body: initData });
      return res.status(502).json({ error: 'Failed to initialize payment', detail: { status: initResp.status, body: initData } });
    }

  // Save reference and create the order with paystackReference present. Include signupId and timing-derived flags
  const reference = initData.data.reference;
  console.log('[initiate-payment] Extracted reference from Paystack:', reference);
  // Build order payload. Note: Appwrite collections may enforce a strict schema.
  // Avoid including attributes that don't exist in the collection schema (they will cause an "Unknown attribute" error).
  // Do NOT trust or persist client-provided boughtWithinOfferWindow at initiate time.
  // The server will set `boughtWithinOfferWindow` only after payment confirmation (webhook).
  const orderPayload = { name, email, phone, city, state, amount, paystackReference: reference, status: 'pending', createdAt };
  console.log('[initiate-payment] Order payload before saving:', JSON.stringify(orderPayload, null, 2));
  if (signup && signup.$id) orderPayload.signupId = signup.$id;
  
  // Store upsellsSelected array (if provided) - more reliable than price-based detection
  const upsellsSelected = req.body && req.body.upsellsSelected;
  if (upsellsSelected && Array.isArray(upsellsSelected)) {
    try {
      orderPayload.upsellsSelected = JSON.stringify(upsellsSelected);
    } catch (e) {
      console.warn('Unable to stringify upsellsSelected:', e);
    }
  }
  
  // Store order details (upsells, etc.) if provided
  const orderData = req.body && req.body.orderData;
  if (orderData) {
    try {
      orderPayload.orderDetails = JSON.stringify(orderData);
    } catch (e) {
      console.warn('Unable to stringify orderData:', e);
    }
  }
  
  // Store countdown timing fields for server-side calculation
  // The server will calculate boughtWithinOfferWindow when payment completes
  const countdownStartTime = req.body?.countdownStartTime;
  const countdownDurationMinutes = req.body?.countdownDurationMinutes;
  console.log('[initiate-payment] Received countdown timing from client:', { 
    countdownStartTime, 
    countdownDurationMinutes,
    hasValues: !!(countdownStartTime && countdownDurationMinutes)
  });
  
  if (countdownStartTime && countdownDurationMinutes) {
    try {
      orderPayload.countdownStartTime = Number(countdownStartTime);
      orderPayload.countdownDurationMinutes = Number(countdownDurationMinutes);
      console.log('[initiate-payment] Added countdown timing to order payload:', { 
        startTime: new Date(Number(countdownStartTime)).toISOString(), 
        durationMins: countdownDurationMinutes,
        payloadNow: orderPayload
      });
    } catch (e) {
      console.warn('Unable to add countdown timing to payload (non-fatal):', e);
    }
  } else {
    console.warn('[initiate-payment] No countdown timing provided - boughtWithinOfferWindow will not be calculated');
  }
  
  // If you need to persist timing fields, either add the field to your Appwrite collection schema
  // (e.g. 'timeSpentBeforeInitiateMs' as a number) or store timing in an existing allowed field.
  console.log('[initiate-payment] Final order payload before createDocument:', JSON.stringify(orderPayload, null, 2));
  const order = await databases.createDocument(ORDERS_DB, ORDERS_COLLECTION, 'unique()', orderPayload);
  console.log('[initiate-payment] Order created in Appwrite:', { orderId: order.$id, paystackReference: order.paystackReference, reference: reference });

    // Removed Zoho call here: Zoho updates will only happen on form submission (/api/subscribe)
    // and on payment completion (webhook/callback). This avoids repeated Zoho requests.

    // Return authorization URL to frontend so it can redirect the user
    res.json({ authorization_url: initData.data.authorization_url, reference });
  } catch (err) {
    console.error('initiate-payment error', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/subscribe - simple landing page signup -> add contact to MAIN_LIST_KEY
app.post('/api/subscribe', async (req, res) => {
  try {
    // Only accept fields that the landing form provides
    const { name, email, phone, pageEnterAt } = req.body || {};
    console.log('/api/subscribe payload received:', { name, email, phone, pageEnterAt });
    if (!name || !email) return res.status(400).json({ error: 'Missing name or email' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email address' });

    // Upsert signup record in signups collection if available
    let signupId = null;
    try {
      if (SIGNUPS_COLLECTION) {
        // Build a secure, unguessable signup id. Use crypto.randomUUID when available.
        const nowMs = pageEnterAt ? Number(pageEnterAt) : Date.now();
        const namePart = (name || '').toLowerCase().replace(/[^a-z]/g, '').slice(0,3) || 'usr';
        let candidateId;
        if (crypto.randomUUID) candidateId = crypto.randomUUID();
        else candidateId = nowMs.toString(36) + '_' + crypto.randomBytes(8).toString('hex');

        // Try to find existing by email first
        const foundByEmail = await databases.listDocuments(SIGNUPS_DB, SIGNUPS_COLLECTION, [ Query.equal('email', email) ]);
  const signupPayload = { name, email, phone, pageEnterAt: nowMs, lastSeenAt: Date.now(), createdAt: new Date().toISOString() };

        if (foundByEmail && foundByEmail.documents && foundByEmail.documents.length) {
          const existing = foundByEmail.documents[0];
          signupId = existing.$id;
          await databases.updateDocument(SIGNUPS_DB, SIGNUPS_COLLECTION, existing.$id, signupPayload);
        } else {
          // Create document with our secure id so client doesn't need to manage it.
          const doc = await databases.createDocument(SIGNUPS_DB, SIGNUPS_COLLECTION, candidateId, signupPayload);
          signupId = doc.$id;
        }
      }
    } catch (e) {
      console.warn('Signup upsert failed (non-fatal):', e.message || e);
    }

    // Set an httpOnly cookie so the frontend doesn't need to persist or send signupId.
    // Note: this cookie will only be sent for cross-origin requests when credentials are included.
      try {
        res.cookie('signupId', signupId, { httpOnly: true, sameSite: COOKIE_SAMESITE, secure: COOKIE_SECURE, maxAge: 7*24*60*60*1000 });
      } catch (e) {
      // If res.cookie isn't available (unlikely), ignore — the JSON still contains the id.
    }

    // Respond immediately so browser receives cookie and can proceed. Do Zoho update asynchronously
    res.json({ ok: true, signupId });

    // Fire-and-forget Zoho update (non-blocking) but make it idempotent:
    // - If the signup doc already records that it was synced to MAIN_LIST_KEY, skip the Zoho call.
    // - On successful Zoho update, mark the signup doc so future requests won't call Zoho again.
    (async () => {
      try {
        const listKey = process.env.MAIN_LIST_KEY;
        // If we don't have a signupId (persistence was skipped), still attempt Zoho but we can't mark the signup record.
        if (!signupId) {
          await zohoAPIUpdate(databases, { name, email, phone }, listKey, 'Landing signup (no signupId)');
          return;
        }

        let latest = null;
        try {
          if (SIGNUPS_COLLECTION) latest = await databases.getDocument(SIGNUPS_DB, SIGNUPS_COLLECTION, signupId);
        } catch (e) {
          // If fetching the latest signup fails, proceed to attempt Zoho (we'll still try to mark it after)
          latest = null;
        }

        if (latest && latest.zohoSubscribedListKey === listKey) {
          console.log('Zoho subscribe skipped: signup already marked for list', listKey, signupId);
          return;
        }

        const zohoRes = await zohoAPIUpdate(databases, { name, email, phone }, listKey, 'Landing signup');
        if (zohoRes && (zohoRes.ok || zohoRes.result)) {
          try {
            if (SIGNUPS_COLLECTION) {
              await databases.updateDocument(SIGNUPS_DB, SIGNUPS_COLLECTION, signupId, { zohoSubscribedAt: Date.now(), zohoSubscribedListKey: listKey });
            }
          } catch (e) {
            console.warn('Failed to mark signup as zohoSubscribed (non-fatal):', e.message || e);
          }
        } else {
          console.warn('zohoAPIUpdate returned non-ok result for subscribe:', zohoRes);
        }
      } catch (zerr) {
        console.error('Zoho subscribe (async) failed:', zerr && zerr.message ? zerr.message : zerr);
      }
    })();
  } catch (err) {
    console.error('subscribe error', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/start - call on landing page load to create a session-like signup and set httpOnly cookie
app.post('/api/start', async (req, res) => {
  try {
    const nowMs = Date.now();
    // Pick up optional name/email/signupId if the page provided them
    const name = (req.body && req.body.name) || (req.query && req.query.name) || '';
    const email = (req.body && req.body.email) || (req.query && req.query.email) || '';
    const providedSignupId = (req.body && req.body.signupId) || (req.query && req.query.signupId) || null;

    // Check if there's already a signupId cookie - if so, don't overwrite it
    const existingSignupId = req.cookies && req.cookies.signupId ? req.cookies.signupId : null;
    
    if (existingSignupId) {
      console.log('/api/start: signupId cookie already exists, skipping creation:', existingSignupId);
      // Just update the existing record's lastSeenAt if we can find it
      try {
        if (SIGNUPS_COLLECTION) {
          const existing = await databases.getDocument(SIGNUPS_DB, SIGNUPS_COLLECTION, existingSignupId).catch(()=>null);
          if (existing) {
            await databases.updateDocument(SIGNUPS_DB, SIGNUPS_COLLECTION, existingSignupId, { lastSeenAt: nowMs });
            console.log('/api/start: updated existing signup lastSeenAt');
          }
        }
      } catch (e) {
        console.warn('/api/start: unable to update existing signup (non-fatal):', e.message || e);
      }
      
      return res.json({ ok: true, signupId: existingSignupId });
    }

    // generate secure id (used when no signupId provided)
    let sessionId = providedSignupId;
    if (!sessionId) {
      if (crypto.randomUUID) sessionId = crypto.randomUUID();
      else sessionId = nowMs.toString(36) + '_' + crypto.randomBytes(8).toString('hex');
    }

  // Build payload with only safe fields. Only persist if we have a name or a valid email,
  // or if an existing signupId was provided (we'll update the existing record in that case).
  const payload = { pageEnterAt: nowMs, lastSeenAt: nowMs, createdAt: new Date().toISOString() };
    if (name && String(name).trim()) payload.name = String(name).trim();
    if (email && isValidEmail(email)) payload.email = String(email).trim();

    try {
      if (SIGNUPS_COLLECTION) {
        if (providedSignupId) {
          // update existing signup doc with pageEnterAt and any safe fields
          try {
            // If doc exists, update; if not, create it to ensure cookie will reference a persisted id
            const existing = await databases.getDocument(SIGNUPS_DB, SIGNUPS_COLLECTION, providedSignupId).catch(()=>null);
            if (existing) {
              await databases.updateDocument(SIGNUPS_DB, SIGNUPS_COLLECTION, providedSignupId, Object.assign({}, existing, payload));
            } else {
              // ensure payload has at least name/email or create empty minimal doc
              const createPayload = Object.assign({}, payload);
              if (!createPayload.name) createPayload.name = '';
              if (!createPayload.email) createPayload.email = '';
              await databases.createDocument(SIGNUPS_DB, SIGNUPS_COLLECTION, providedSignupId, createPayload);
            }
          } catch (e) {
            console.warn('/api/start: unable to update/create provided signupId (non-fatal):', e.message || e);
          }
        } else {
          // Only attempt to persist if we have a name or a valid email to avoid schema validation errors
          if (payload.name || payload.email) {
              await databases.createDocument(SIGNUPS_DB, SIGNUPS_COLLECTION, sessionId, payload);
            } else {
              // Debug: log minimal request info so we can see why name/email are missing
              try {
                const incoming = {
                  headers: { cookie: req.headers && req.headers.cookie },
                  cookies: req.cookies || {},
                  body: (req.body && Object.keys(req.body).length) ? req.body : undefined,
                  rawBodyLength: req.rawBody ? req.rawBody.length : 0
                };
                console.warn('/api/start: skipping Appwrite persistence because name/email not present or invalid; cookie will still be set. incoming=', JSON.stringify(incoming));
              } catch (e) {
                console.warn('/api/start: skipping Appwrite persistence; additionally failed to log incoming request (non-fatal)');
              }
            }
        }
      } else {
        console.warn('No SIGNUPS_COLLECTION configured; /api/start will set cookie but not persist session');
      }
    } catch (e) {
      console.warn('/api/start: unable to persist session (non-fatal):', e.message || e);
    }

    // Set httpOnly cookie so client doesn't need to manage the id. SameSite Lax is fine for same-origin.
    try {
      res.cookie('signupId', sessionId, { httpOnly: true, sameSite: COOKIE_SAMESITE, secure: COOKIE_SECURE, maxAge: 24*60*60*1000 });
    } catch (e) {
      // res.cookie should exist, but guard in case the environment lacks it
      console.warn('/api/start: unable to set cookie (non-fatal):', e.message || e);
    }

    return res.json({ ok: true, signupId: sessionId });
  } catch (err) {
    console.error('/api/start error', err);
    return res.status(500).json({ error: String(err.message || err) });
  }
});

// NOTE: /api/signup-heartbeat removed — heartbeats are no longer used.

// GET /api/signup-status - return eligibility and current timeSpent for a signup (minimal payload)
app.get('/api/signup-status', async (req, res) => {
  try {
    // Prefer cookie, then query param, then email
    const signupId = req.cookies && req.cookies.signupId ? req.cookies.signupId : (req.query.signupId || null);
    const email = req.query.email || null;
    if (!signupId && !email) return res.status(400).json({ error: 'Missing signupId or email' });

    let signup = null;
    try {
      if (signupId && SIGNUPS_COLLECTION) signup = await databases.getDocument(SIGNUPS_DB, SIGNUPS_COLLECTION, signupId);
      else if (email && SIGNUPS_COLLECTION) {
        const found = await databases.listDocuments(SIGNUPS_DB, SIGNUPS_COLLECTION, [ Query.equal('email', email) ]);
        if (found && found.documents && found.documents.length) signup = found.documents[0];
      }
    } catch (e) {
      console.warn('/api/signup-status: unable to load signup (non-fatal):', e.message || e);
    }

  const nowMs = Date.now();
  const pageEnterAt = signup && signup.pageEnterAt ? Number(signup.pageEnterAt) : null;
  const timeSpentMs = pageEnterAt ? Math.round(nowMs - pageEnterAt) : null;

  // We no longer expose eligibility via this endpoint. Time on page is still provided
  // for informational purposes only.
  return res.json({ timeSpentMs });
  } catch (err) {
    console.error('signup-status error', err);
    return res.status(500).json({ error: String(err.message || err) });
  }
});

// ... debug endpoint removed per request

// Paystack webhook
app.post('/api/paystack-webhook', async (req, res) => {
  const hash = req.headers['x-paystack-signature'];
  const hmac = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(req.rawBody).digest('hex');
  if (hash !== hmac) return res.sendStatus(401);

  const event = req.body;
  if (event.event === 'charge.success') {
    try {
      const paymentData = event.data;
      const docs = await databases.listDocuments(ORDERS_DB, ORDERS_COLLECTION, [ Query.equal('paystackReference', paymentData.reference) ]);
      if (!docs.documents.length) throw new Error('Order not found');
      const order = docs.documents[0];

      // compute paidAt and attempt to compute timing from linked signup
      const paidAt = new Date().toISOString();
      let timeSpentUntilPaidMs = null;
      let purchasedBeforeDeadline = false;
      let boughtWithinOfferWindow = false;
      
      try {
        // Calculate boughtWithinOfferWindow from countdown timing if available
        if (order.countdownStartTime && order.countdownDurationMinutes) {
          const countdownStartMs = Number(order.countdownStartTime);
          const countdownDurationMs = Number(order.countdownDurationMinutes) * 60 * 1000;
          const currentTimeMs = Date.now();
          const elapsedMs = currentTimeMs - countdownStartMs;
          boughtWithinOfferWindow = elapsedMs <= countdownDurationMs;
          console.log('[webhook] Countdown calculation:', {
            startTime: new Date(countdownStartMs).toISOString(),
            durationMins: order.countdownDurationMinutes,
            elapsedMins: (elapsedMs / 60000).toFixed(2),
            withinWindow: boughtWithinOfferWindow
          });
          purchasedBeforeDeadline = boughtWithinOfferWindow;
        } else if (typeof order.boughtWithinOfferWindow !== 'undefined') {
          // Fallback: If the order explicitly recorded boughtWithinOfferWindow at payment-init, use it
          purchasedBeforeDeadline = !!order.boughtWithinOfferWindow;
        } else {
          let signupRec = null;
          if (order.signupId && SIGNUPS_COLLECTION) signupRec = await safeGetDocument(SIGNUPS_DB, SIGNUPS_COLLECTION, order.signupId);
          else if (order.email && SIGNUPS_COLLECTION) {
            const found = await databases.listDocuments(SIGNUPS_DB, SIGNUPS_COLLECTION, [ Query.equal('email', order.email) ]).catch(()=>({ documents: [] }));
            if (found && found.documents && found.documents.length) signupRec = found.documents[0];
          }

          if (signupRec && signupRec.pageEnterAt) {
            const paidAtMs = Date.now();
            timeSpentUntilPaidMs = paidAtMs - Number(signupRec.pageEnterAt);
            const offerDeadlineRaw = signupRec.offerDeadline || null;
            const offerDeadlineMs = normalizeTimestampToMs(offerDeadlineRaw) || (Number(signupRec.pageEnterAt) + OFFER_WINDOW_MS);
            purchasedBeforeDeadline = paidAtMs <= offerDeadlineMs;
          }
        }
      } catch (e) {
        console.warn('Unable to compute timing from signup (non-fatal):', e.message || e);
      }

      // Persist paid status and record whether the buyer was within the offer window
      const boughtFlag = !!purchasedBeforeDeadline;
      try {
        await databases.updateDocument(ORDERS_DB, ORDERS_COLLECTION, order.$id, { status: 'paid', paidAt, timeSpentUntilPaidMs, boughtWithinOfferWindow: boughtFlag });
      } catch (e) {
        // If Appwrite schema doesn't allow `boughtWithinOfferWindow`, fall back to updating without it
        console.warn('Unable to persist boughtWithinOfferWindow to order (non-fatal):', e.message || e);
        await databases.updateDocument(ORDERS_DB, ORDERS_COLLECTION, order.$id, { status: 'paid', paidAt, timeSpentUntilPaidMs });
      }

      const paidListKey = purchasedBeforeDeadline ? process.env.PAID_BEFORE_LIST_KEY || process.env.PAID_LIST_KEY : process.env.PAID_AFTER_LIST_KEY || process.env.PAID_LIST_KEY;

      // Note: Zoho sync intentionally removed from webhook to avoid server-side-only confirmation issues.
      // The webhook now only marks the order as paid. Zoho sync will be performed securely by the
      // browser redirect flow in /api/paystack-callback so the user can complete any email confirmations.

      return res.sendStatus(200);
    } catch (err) {
      console.error('webhook error', err);
      return res.sendStatus(500);
    }
  }

  res.sendStatus(200);
});

// Paystack callback (browser redirect after payment) -- verify then redirect to thank you
app.get('/api/paystack-callback', async (req, res) => {
  const reference = req.query.reference || req.query.trxref || req.query.transaction_id;
  console.log('[Callback GET] Reference:', reference, 'Query:', req.query);
  if (!reference) {
    console.error('[Callback GET] Missing reference in query params');
    return res.status(400).send('Missing reference');
  }

  try {
    // Verify transaction with Paystack
    const verifyResp = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
    });
    const verifyData = await verifyResp.json();
    if (!verifyResp.ok || !verifyData.status) {
      console.error('Paystack verify failed', verifyData);
      // Redirect to a failure page or show error; here redirect to frontend thankyou with ?status=failed
      const failUrl = (process.env.FRONTEND_BASE_URL || '') + '/thankyou.html?status=failed';
      return res.redirect(failUrl);
    }

  const payment = verifyData.data;
    if (payment.status !== 'success') {
      const failUrl = (process.env.FRONTEND_BASE_URL || '') + '/thankyou.html?status=failed';
      return res.redirect(failUrl);
    }

    // Find order by paystack reference
    const docs = await databases.listDocuments(ORDERS_DB, ORDERS_COLLECTION, [ Query.equal('paystackReference', payment.reference) ]);
    if (!docs.documents.length) {
      console.warn('Order not found for reference during callback:', payment.reference);
      // Still redirect to thank you but include reference
      const url = new URL((process.env.FRONTEND_BASE_URL || '') + '/thankyou.html', 'http://localhost');
      url.searchParams.set('reference', payment.reference);
      return res.redirect(url.toString());
    }

    const order = docs.documents[0];
    console.log('[callback] Order retrieved:', { 
      orderId: order.$id, 
      hasCountdownStartTime: !!order.countdownStartTime,
      hasCountdownDuration: !!order.countdownDurationMinutes,
      countdownStartTime: order.countdownStartTime,
      countdownDurationMinutes: order.countdownDurationMinutes
    });

    // compute paidAt and attempt to compute timing from signup
    const paidAt = new Date().toISOString();
    let timeSpentUntilPaidMs = null;
    let purchasedBeforeDeadline = false;
    let boughtWithinOfferWindow = false; // Will be calculated from countdown timing
    
      try {
        // Calculate boughtWithinOfferWindow from countdown timing if available
        if (order.countdownStartTime && order.countdownDurationMinutes) {
          const countdownStartMs = Number(order.countdownStartTime);
          const countdownDurationMs = Number(order.countdownDurationMinutes) * 60 * 1000;
          const currentTimeMs = Date.now();
          const elapsedMs = currentTimeMs - countdownStartMs;
          boughtWithinOfferWindow = elapsedMs <= countdownDurationMs;
          console.log('[callback] Countdown calculation:', {
            startTime: new Date(countdownStartMs).toISOString(),
            durationMins: order.countdownDurationMinutes,
            elapsedMins: (elapsedMs / 60000).toFixed(2),
            withinWindow: boughtWithinOfferWindow
          });
          purchasedBeforeDeadline = boughtWithinOfferWindow;
        } else if (typeof order.boughtWithinOfferWindow !== 'undefined') {
          // Fallback to stored flag if countdown timing not available
          console.log('[callback] Using stored boughtWithinOfferWindow flag:', order.boughtWithinOfferWindow);
          purchasedBeforeDeadline = !!order.boughtWithinOfferWindow;
        } else {
          console.warn('[callback] No countdown timing or stored flag - falling back to signup timing');
          let signupRec = null;
          if (order.signupId && SIGNUPS_COLLECTION) signupRec = await safeGetDocument(SIGNUPS_DB, SIGNUPS_COLLECTION, order.signupId);
          else if (order.email && SIGNUPS_COLLECTION) {
            const found = await databases.listDocuments(SIGNUPS_DB, SIGNUPS_COLLECTION, [ Query.equal('email', order.email) ]).catch(()=>({ documents: [] }));
            if (found && found.documents && found.documents.length) signupRec = found.documents[0];
          }

          if (signupRec && signupRec.pageEnterAt) {
            const paidAtMs = Date.now();
            timeSpentUntilPaidMs = paidAtMs - Number(signupRec.pageEnterAt);
            const offerDeadlineRaw = signupRec.offerDeadline || null;
            const offerDeadlineMs = normalizeTimestampToMs(offerDeadlineRaw) || (Number(signupRec.pageEnterAt) + OFFER_WINDOW_MS);
            purchasedBeforeDeadline = paidAtMs <= offerDeadlineMs;
          }
        }
      } catch (e) {
        console.warn('Unable to compute timing from signup on callback (non-fatal):', e.message || e);
      }

    if (order.status !== 'paid') {
      // Persist calculated boughtWithinOfferWindow along with paid status
      try {
        await databases.updateDocument(ORDERS_DB, ORDERS_COLLECTION, order.$id, { 
          status: 'paid', 
          paidAt, 
          timeSpentUntilPaidMs,
          boughtWithinOfferWindow: purchasedBeforeDeadline
        });
      } catch (e) {
        // If boughtWithinOfferWindow field doesn't exist, update without it
        console.warn('Unable to persist boughtWithinOfferWindow (non-fatal):', e.message || e);
        await databases.updateDocument(ORDERS_DB, ORDERS_COLLECTION, order.$id, { status: 'paid', paidAt, timeSpentUntilPaidMs });
      }
    }

    // Note: Zoho sync moved to webhook only to avoid duplicate list adds when both
    // webhook and callback are invoked by Paystack. The webhook is the authoritative
    // source for server-side post-payment processing and will perform the Zoho update.
  // Determine which paid list to use (use already calculated purchasedBeforeDeadline from above)

    const paidListKey = purchasedBeforeDeadline ? process.env.PAID_BEFORE_LIST_KEY || process.env.PAID_LIST_KEY : process.env.PAID_AFTER_LIST_KEY || process.env.PAID_LIST_KEY;

    // Get segmentation list based on which upsells were selected
    const segmentationListKey = getZohoSegmentationList(order.upsellsSelected);
    
    // Perform idempotent Zoho sync from callback (browser flow)
    try {
      // Add to main paid list first (PAID_BEFORE or PAID_AFTER)
      if (order.zohoSynced && order.zohoSyncedListKey === paidListKey) {
        console.log('Callback: skipping main Zoho sync; order already zohoSynced', order.$id, paidListKey);
      } else {
        const zohoRes = await zohoAPIUpdate(databases, order, paidListKey, 'Paid successfully (callback)');
        console.log('zohoAPIUpdate (callback) main list result for order', order.$id, 'listKey', paidListKey, '->', zohoRes);
        try {
          const respStr = typeof zohoRes === 'string' ? zohoRes : JSON.stringify(zohoRes);
          await databases.updateDocument(ORDERS_DB, ORDERS_COLLECTION, order.$id, { zohoLastResponse: respStr });
        } catch (e) {
          console.warn('Unable to persist zohoLastResponse (non-fatal):', e.message || e);
        }
        if (zohoRes && (zohoRes.ok || zohoRes.result)) {
          try {
            await databases.updateDocument(ORDERS_DB, ORDERS_COLLECTION, order.$id, { zohoSynced: true, zohoSyncedListKey: paidListKey, zohoSyncedAt: Date.now() });
          } catch (e) {
            console.warn('Unable to mark order as zohoSynced (non-fatal):', e.message || e);
          }
        }
      }
      
      // Add to upsell segmentation list if applicable
      if (segmentationListKey && segmentationListKey !== paidListKey) {
        try {
          console.log('Adding buyer to segmentation list:', segmentationListKey, 'based on upsells:', order.upsellsSelected, 'for order', order.$id);
          const segmentZohoRes = await zohoAPIUpdate(databases, order, segmentationListKey, 'Upsell segmentation (callback)');
          console.log('Segmentation list add result:', segmentationListKey, '->', segmentZohoRes);
        } catch (segmentErr) {
          console.error('Failed to add to segmentation list', segmentationListKey, 'for order', order.$id, segmentErr);
        }
      } else if (!segmentationListKey) {
        console.warn('No segmentation list determined for order', order.$id, 'upsells:', order.upsellsSelected);
      }
    } catch (zerr) {
      console.error('zohoAPIUpdate (callback) failed for order', order.$id, zerr);
    }

    console.log('Callback: payment verified, redirecting user. Zoho sync attempted in callback if needed. orderId=', order.$id);

    // Redirect buyer to thank you page with name/email and reference
    const frontendBase = process.env.FRONTEND_BASE_URL || '';
    const thankUrl = new URL(frontendBase + '/thankyou-order.html', 'http://localhost');
    if (order.name) thankUrl.searchParams.set('name', order.name);
    if (order.email) thankUrl.searchParams.set('email', order.email);
    if (reference) thankUrl.searchParams.set('reference', reference);

    return res.redirect(thankUrl.toString());
  } catch (err) {
    console.error('Error in paystack-callback:', err);
    const failUrl = (process.env.FRONTEND_BASE_URL || '') + '/thankyou.html?status=error';
    return res.redirect(failUrl);
  }
});

// POST handler for callback (in case Paystack POSTs instead of redirects)
app.post('/api/paystack-callback', async (req, res) => {
  // Extract reference from webhook payload structure or query
  const reference = (req.body && req.body.data && req.body.data.reference) 
    || (req.body && req.body.reference) 
    || req.query.reference 
    || req.query.trxref;
  console.log('[Callback POST] Reference:', reference, 'Body:', req.body, 'Query:', req.query);
  
  if (!reference) {
    console.error('[Callback POST] Missing reference in body and query');
    return res.status(400).json({ error: 'Missing reference' });
  }

  try {
    // Verify transaction with Paystack
    const verifyResp = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
    });
    const verifyData = await verifyResp.json();
    if (!verifyResp.ok || !verifyData.status) {
      console.error('[Callback POST] Paystack verify failed', verifyData);
      return res.status(400).json({ error: 'Payment verification failed', detail: verifyData });
    }

    const payment = verifyData.data;
    if (payment.status !== 'success') {
      console.error('[Callback POST] Payment status not success:', payment.status);
      return res.status(400).json({ error: 'Payment not successful', status: payment.status });
    }

    // Find order by paystack reference
    console.log('[Callback POST] Searching for order with paystackReference:', payment.reference);
    let docs = await databases.listDocuments(ORDERS_DB, ORDERS_COLLECTION, [ Query.equal('paystackReference', payment.reference) ]);
    console.log('[Callback POST] Search result:', { found: docs.documents.length, total: docs.total });
    
    // Fallback: If not found by reference, try searching by email and amount
    if (!docs.documents.length) {
      console.log('[Callback POST] Reference not found, trying fallback search by email+amount:', payment.customer.email, payment.amount/100);
      try {
        const emailDocs = await databases.listDocuments(ORDERS_DB, ORDERS_COLLECTION, [ 
          Query.equal('email', payment.customer.email),
          Query.equal('status', 'pending'),
          Query.orderDesc('$createdAt'),
          Query.limit(5)
        ]);
        console.log('[Callback POST] Email search found:', emailDocs.documents.length, 'pending orders');
        // Find the most recent order with matching amount
        const matchingOrder = emailDocs.documents.find(o => Math.abs(Number(o.amount) - (payment.amount/100)) < 0.01);
        if (matchingOrder) {
          console.log('[Callback POST] Found matching order by email+amount:', matchingOrder.$id, 'Updating paystackReference to:', payment.reference);
          // Update the order with the correct webhook reference
          await databases.updateDocument(ORDERS_DB, ORDERS_COLLECTION, matchingOrder.$id, { paystackReference: payment.reference });
          // Reload the order to get all fields including upsellsSelected
          const reloaded = await databases.getDocument(ORDERS_DB, ORDERS_COLLECTION, matchingOrder.$id);
          docs = { documents: [reloaded], total: 1 };
        }
      } catch (e) {
        console.error('[Callback POST] Fallback search failed:', e);
      }
    }
    
    if (!docs.documents.length) {
      console.warn('[Callback POST] Order not found for reference:', payment.reference);
      // Debug: List all recent orders to see what references exist
      try {
        const allRecent = await databases.listDocuments(ORDERS_DB, ORDERS_COLLECTION, [ Query.limit(5), Query.orderDesc('$createdAt') ]);
        console.log('[Callback POST DEBUG] Recent orders:', allRecent.documents.map(d => ({ id: d.$id, ref: d.paystackReference, email: d.email, status: d.status, amount: d.amount })));
      } catch (e) {
        console.error('[Callback POST DEBUG] Failed to list recent orders:', e);
      }
      // Return 200 OK to prevent Paystack from retrying old webhooks
      return res.json({ ok: false, message: 'Order not found, likely an old test payment' });
    }

    const order = docs.documents[0];
    console.log('[Callback POST] Found order:', order.$id);
    console.log('[Callback POST] Order countdown data:', { 
      hasCountdownStartTime: !!order.countdownStartTime,
      hasCountdownDuration: !!order.countdownDurationMinutes,
      countdownStartTime: order.countdownStartTime,
      countdownDurationMinutes: order.countdownDurationMinutes
    });

    // Compute timing and determine which list to use (same logic as webhook)
    const paidAt = new Date().toISOString();
    let timeSpentUntilPaidMs = null;
    let purchasedBeforeDeadline = false;
    let boughtWithinOfferWindow = false;
    
    try {
      // Calculate boughtWithinOfferWindow from countdown timing if available
      if (order.countdownStartTime && order.countdownDurationMinutes) {
        const countdownStartMs = Number(order.countdownStartTime);
        const countdownDurationMs = Number(order.countdownDurationMinutes) * 60 * 1000;
        const currentTimeMs = Date.now();
        const elapsedMs = currentTimeMs - countdownStartMs;
        boughtWithinOfferWindow = elapsedMs <= countdownDurationMs;
        console.log('[Callback POST] Countdown calculation:', {
          startTime: new Date(countdownStartMs).toISOString(),
          currentTime: new Date(currentTimeMs).toISOString(),
          durationMins: order.countdownDurationMinutes,
          elapsedMins: (elapsedMs / 60000).toFixed(2),
          withinWindow: boughtWithinOfferWindow
        });
        purchasedBeforeDeadline = boughtWithinOfferWindow;
      } else if (typeof order.boughtWithinOfferWindow !== 'undefined') {
        // Fallback to stored flag if countdown timing not available
        console.log('[Callback POST] Using stored boughtWithinOfferWindow flag:', order.boughtWithinOfferWindow);
        purchasedBeforeDeadline = !!order.boughtWithinOfferWindow;
      } else {
        let signupRec = null;
        if (order.signupId && SIGNUPS_COLLECTION) signupRec = await safeGetDocument(SIGNUPS_DB, SIGNUPS_COLLECTION, order.signupId);
        else if (order.email && SIGNUPS_COLLECTION) {
          const found = await databases.listDocuments(SIGNUPS_DB, SIGNUPS_COLLECTION, [ Query.equal('email', order.email) ]).catch(()=>({ documents: [] }));
          if (found && found.documents && found.documents.length) signupRec = found.documents[0];
        }

        if (signupRec && signupRec.pageEnterAt) {
          const paidAtMs = Date.now();
          timeSpentUntilPaidMs = paidAtMs - Number(signupRec.pageEnterAt);
          const offerDeadlineRaw = signupRec.offerDeadline || null;
          const offerDeadlineMs = normalizeTimestampToMs(offerDeadlineRaw) || (Number(signupRec.pageEnterAt) + OFFER_WINDOW_MS);
          purchasedBeforeDeadline = paidAtMs <= offerDeadlineMs;
        }
      }
    } catch (e) {
      console.warn('[Callback POST] Unable to compute timing from signup (non-fatal):', e.message || e);
    }

    // Update order status if not already paid
    if (order.status !== 'paid') {
      await databases.updateDocument(ORDERS_DB, ORDERS_COLLECTION, order.$id, { status: 'paid', paidAt, timeSpentUntilPaidMs });
    }

    const paidListKey = purchasedBeforeDeadline ? process.env.PAID_BEFORE_LIST_KEY || process.env.PAID_LIST_KEY : process.env.PAID_AFTER_LIST_KEY || process.env.PAID_LIST_KEY;

    // Get segmentation list based on which upsells were selected
    const segmentationListKey = getZohoSegmentationList(order.upsellsSelected);
    
    // Perform idempotent Zoho sync
    try {
      // Add to main paid list first (PAID_BEFORE or PAID_AFTER)
      if (order.zohoSynced && order.zohoSyncedListKey === paidListKey) {
        console.log('[Callback POST] Skipping main Zoho sync; order already zohoSynced', order.$id, paidListKey);
      } else {
        const zohoRes = await zohoAPIUpdate(databases, order, paidListKey, 'Paid successfully (POST callback)');
        console.log('[Callback POST] zohoAPIUpdate main list result for order', order.$id, 'listKey', paidListKey, '->', zohoRes);
        try {
          const respStr = typeof zohoRes === 'string' ? zohoRes : JSON.stringify(zohoRes);
          await databases.updateDocument(ORDERS_DB, ORDERS_COLLECTION, order.$id, { zohoLastResponse: respStr });
        } catch (e) {
          console.warn('[Callback POST] Unable to persist zohoLastResponse (non-fatal):', e.message || e);
        }
        if (zohoRes && (zohoRes.ok || zohoRes.result)) {
          try {
            await databases.updateDocument(ORDERS_DB, ORDERS_COLLECTION, order.$id, { zohoSynced: true, zohoSyncedListKey: paidListKey, zohoSyncedAt: Date.now() });
          } catch (e) {
            console.warn('[Callback POST] Unable to mark order as zohoSynced (non-fatal):', e.message || e);
          }
        }
      }
      
      // Add to upsell segmentation list if applicable
      if (segmentationListKey && segmentationListKey !== paidListKey) {
        try {
          console.log('[Callback POST] Adding buyer to segmentation list:', segmentationListKey, 'based on upsells:', order.upsellsSelected, 'for order', order.$id);
          const segmentZohoRes = await zohoAPIUpdate(databases, order, segmentationListKey, 'Upsell segmentation (POST callback)');
          console.log('[Callback POST] Segmentation list add result:', segmentationListKey, '->', segmentZohoRes);
        } catch (segmentErr) {
          console.error('[Callback POST] Failed to add to segmentation list', segmentationListKey, 'for order', order.$id, segmentErr);
        }
      } else if (!segmentationListKey) {
        console.warn('[Callback POST] No segmentation list determined for order', order.$id, 'upsells:', order.upsellsSelected);
      }
    } catch (zerr) {
      console.error('[Callback POST] zohoAPIUpdate failed for order', order.$id, zerr);
    }

    console.log('[Callback POST] Payment verified, Zoho sync attempted. orderId=', order.$id);

    // Return success (no redirect for POST)
    return res.json({ 
      ok: true, 
      orderId: order.$id,
      status: 'Payment confirmed',
      redirectUrl: `${process.env.FRONTEND_BASE_URL}/thankyou-order.html?reference=${reference}`
    });
  } catch (err) {
    console.error('[Callback POST] Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/update-order-reference - update order with actual Paystack reference from popup callback
app.post('/api/update-order-reference', async (req, res) => {
  try {
    const { initReference, actualReference } = req.body || {};
    console.log('[update-order-reference] Init ref:', initReference, 'Actual ref:', actualReference);
    
    if (!initReference || !actualReference) {
      return res.status(400).json({ error: 'Missing references' });
    }

    // Find order by init reference and update with actual reference
    const docs = await databases.listDocuments(ORDERS_DB, ORDERS_COLLECTION, [ Query.equal('paystackReference', initReference) ]);
    if (docs.documents.length) {
      const order = docs.documents[0];
      await databases.updateDocument(ORDERS_DB, ORDERS_COLLECTION, order.$id, { paystackReference: actualReference });
      console.log('[update-order-reference] Updated order', order.$id, 'with actual reference:', actualReference);
      return res.json({ ok: true, orderId: order.$id });
    }

    console.warn('[update-order-reference] Order not found for init reference:', initReference);
    return res.status(404).json({ error: 'Order not found' });
  } catch (err) {
    console.error('[update-order-reference] Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/confirm-unconfirmed-payment - adds user to unconfirmed payment Zoho list
app.post('/api/confirm-unconfirmed-payment', async (req, res) => {
  try {
    const { paymentMethod } = req.body || {};
    console.log('/api/confirm-unconfirmed-payment payload received:', { paymentMethod });
    
    // Get signupId from cookie (same pattern as other endpoints)
    const signupId = req.cookies && req.cookies.signupId ? req.cookies.signupId : null;
    console.log('Debug - signupId from cookie:', signupId);
    console.log('Debug - all cookies:', req.cookies);
    
    if (!signupId) {
      console.log('Debug - No signupId cookie found');
      return res.status(400).json({ error: 'No signup session found. Please refresh the page and try again.' });
    }

    // Get signup record to extract user details
    let signup = null;
    try {
      console.log('Debug - Attempting to fetch signup record with:', { SIGNUPS_DB, SIGNUPS_COLLECTION, signupId });
      if (SIGNUPS_COLLECTION) {
        signup = await safeGetDocument(SIGNUPS_DB, SIGNUPS_COLLECTION, signupId);
        console.log('Debug - Signup record found:', signup ? 'Yes' : 'No');
        if (signup) {
          console.log('Debug - Signup record contents:', { id: signup.$id, email: signup.email, name: signup.name, phone: signup.phone });
        }
      } else {
        console.log('Debug - SIGNUPS_COLLECTION not configured');
      }
    } catch (e) {
      console.error('Error fetching signup record:', e);
    }

    if (!signup || !signup.email) {
      console.log('Debug - Signup validation failed:', { hasSignup: !!signup, hasEmail: signup?.email });
      return res.status(400).json({ error: 'User details not found. Please refresh the page and try again.' });
    }

    const email = signup.email;
    const name = signup.name || email.split('@')[0];

    // Get the unconfirmed payment list key from environment
    const unconfirmedListKey = process.env.UNCONFIRMED_PAYMENT_LIST_KEY;
    if (!unconfirmedListKey) {
      console.error('UNCONFIRMED_PAYMENT_LIST_KEY not configured in environment');
      return res.status(500).json({ error: 'Unconfirmed payment list not configured' });
    }

    // Respond immediately to the client
    res.json({ ok: true, message: 'Payment confirmation submitted successfully' });

    // Fire-and-forget Zoho update (non-blocking)
    (async () => {
      try {
        console.log('Adding user to unconfirmed payment list:', { name, email, paymentMethod, unconfirmedListKey });
        
        // Create a minimal user data object for Zoho update (same pattern as paid users)
        const userData = {
          name: name,
          email: email,
          phone: signup.phone || '',
          city: signup.city || '',
          state: signup.state || ''
        };

        const zohoResult = await zohoAPIUpdate(databases, userData, unconfirmedListKey, 'Unconfirmed payment submission');
        console.log('Zoho unconfirmed payment list update result:', zohoResult);
      } catch (zohoErr) {
        console.error('Error adding to unconfirmed payment list:', zohoErr);
        // Don't fail the response - this is fire-and-forget
      }
    })();
  } catch (err) {
    console.error('confirm-unconfirmed-payment error', err);
    return res.status(500).json({ error: err.message });
  }
});

export default app;


// Admin endpoint: re-run Zoho sync for a specific order (useful if tokens were missing earlier)
app.post('/api/zoho-reprocess-order', async (req, res) => {
  try {
    const { orderId } = req.body || {};
    if (!orderId) return res.status(400).json({ error: 'Missing orderId' });

    const orderDoc = await databases.getDocument(ORDERS_DB, ORDERS_COLLECTION, orderId).catch(()=>null);
    if (!orderDoc) return res.status(404).json({ error: 'Order not found' });

    // Determine paidListKey same as webhook: prefer persisted boughtWithinOfferWindow else compute from signup
    let purchasedBeforeDeadline = false;
    if (typeof orderDoc.boughtWithinOfferWindow !== 'undefined') purchasedBeforeDeadline = !!orderDoc.boughtWithinOfferWindow;
    else {
      let signupRec = null;
      if (orderDoc.signupId && SIGNUPS_COLLECTION) signupRec = await safeGetDocument(SIGNUPS_DB, SIGNUPS_COLLECTION, orderDoc.signupId);
      else if (orderDoc.email && SIGNUPS_COLLECTION) {
        const found = await databases.listDocuments(SIGNUPS_DB, SIGNUPS_COLLECTION, [ Query.equal('email', orderDoc.email) ]).catch(()=>({ documents: [] }));
        if (found && found.documents && found.documents.length) signupRec = found.documents[0];
      }
      if (signupRec && signupRec.pageEnterAt) {
        const paidAtMs = Date.now();
        const offerDeadlineRaw = signupRec.offerDeadline || null;
        const offerDeadlineMs = normalizeTimestampToMs(offerDeadlineRaw) || (Number(signupRec.pageEnterAt) + OFFER_WINDOW_MS);
        purchasedBeforeDeadline = paidAtMs <= offerDeadlineMs;
      }
    }

    const paidListKey = purchasedBeforeDeadline ? process.env.PAID_BEFORE_LIST_KEY || process.env.PAID_LIST_KEY : process.env.PAID_AFTER_LIST_KEY || process.env.PAID_LIST_KEY;

    const zohoRes = await zohoAPIUpdate(databases, orderDoc, paidListKey, 'Reprocess order (admin)');
    // persist response and update markers when successful
    try {
      const respStr = typeof zohoRes === 'string' ? zohoRes : JSON.stringify(zohoRes);
      await databases.updateDocument(ORDERS_DB, ORDERS_COLLECTION, orderId, { zohoLastResponse: respStr });
    } catch (e) {
      console.warn('Unable to persist zohoLastResponse on reprocess (non-fatal):', e.message || e);
    }
    if (zohoRes && (zohoRes.ok || zohoRes.result)) {
      try {
        await databases.updateDocument(ORDERS_DB, ORDERS_COLLECTION, orderId, { zohoSynced: true, zohoSyncedListKey: paidListKey, zohoSyncedAt: Date.now(), boughtWithinOfferWindow: purchasedBeforeDeadline });
      } catch (e) {
        console.warn('Unable to mark order as zohoSynced on reprocess (non-fatal):', e.message || e);
      }
    }

    return res.json({ ok: true, zohoRes });
  } catch (err) {
    console.error('zoho-reprocess-order error', err);
    return res.status(500).json({ error: String(err.message || err) });
  }
});


// Zoho contact sync helper
async function zohoAPIUpdate(databases, userData, listKey, source) {
  // 1. Get OAuth token from util
  const access_token = await getValidZohoToken(databases);

  const contactInfo = {
    'First Name': userData.name.split(' ')[0],
    'Last Name': userData.name.split(' ').slice(1).join(' ') || '',
    'Contact Email': userData.email,
    'Phone': userData.phone,
    'City': userData.city,
    'State': userData.state
  };

  const params = new URLSearchParams();
  params.append('listkey', listKey);
  params.append('resfmt', 'JSON');
  params.append('source', source);
  params.append('contactinfo', JSON.stringify(contactInfo));

  // Reset daily counter if date changed
  resetZohoDailyIfNeeded();

  // Check daily quota before making the Zoho call
  if (ZOHO_DAILY_QUOTA && zohoDaily.count >= ZOHO_DAILY_QUOTA) {
    console.warn(`zohoAPIUpdate: daily quota reached (${zohoDaily.count}/${ZOHO_DAILY_QUOTA}); skipping call`);
    return { skipped: true, reason: 'daily_quota_exceeded' };
  }

  // per-email cooldown removed: always attempt Zoho call unless daily quota exceeded

  const response = await fetch('https://campaigns.zoho.com/api/v1.1/json/listsubscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Zoho-oauthtoken ${access_token}`
    },
    body: params.toString()
  });

  const text = await response.text();
  // Try to parse JSON to check for Zoho-specific error codes; fallback to raw text
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { /* not JSON */ }

  console.log('zohoAPIUpdate: response text:', text);
  if (parsed) console.log('zohoAPIUpdate: parsed response:', parsed);

  if (!response.ok) {
    console.error('Zoho API failed:', response.status, text);
    // Zoho returns an error object with code '2708' when it is throttling confirmation emails
    // e.g. { code: '2708', message: 'The confirmation email cannot be sent at this time due to multiple recent requests.', status: 'error' }
    try {
      const errCode = parsed && parsed.code ? String(parsed.code) : null;
      const email = (userData && userData.email) || (userData && userData['Contact Email']) || '';
      if (errCode === '2708') {
        // Zoho is throttling confirmation emails; log and allow caller to handle retry logic.
        console.warn(`zohoAPIUpdate: Zoho returned code 2708 (throttling).`);
        return { skipped: true, reason: 'zoho_2708', detail: parsed || text };
      }
    } catch (e) {
      // continue to throw below
    }
    throw new Error(`Zoho update failed: ${text}`);
  }

  // If Zoho responded OK but includes a message indicating throttling, honor it too
  if (parsed && parsed.code === '2708') {
    console.warn(`zohoAPIUpdate: Zoho returned code 2708 in success body (throttling).`);
    return { skipped: true, reason: 'zoho_2708' };
  }

  console.log('Zoho API response:', text);
  // increment daily counter and persist if configured
  try {
    zohoDaily.count = (zohoDaily.count || 0) + 1;
    // persist asynchronously but await so quota stays consistent across restarts if Appwrite is configured
    await persistZohoDaily(databases);
  } catch (e) {
    console.warn('zohoAPIUpdate: unable to persist daily quota (non-fatal):', e.message || e);
  }
  return { ok: true, result: parsed || text };
}

// --- Telegram Invite Link Helper ---
// Duration in days for the Telegram invite to expire. Edit value as needed.
const TELEGRAM_INVITE_EXPIRE_DAYS = parseInt(process.env.TELEGRAM_INVITE_EXPIRE_DAYS, 10) || 7;

// Create a one-time Telegram invite link for the customer after successful payment
async function createTelegramInvite() {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!chatId || !botToken) throw new Error('TELEGRAM_CHAT_ID or TELEGRAM_BOT_TOKEN missing in environment');
  const res = await fetch(`https://api.telegram.org/bot${botToken}/createChatInviteLink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      member_limit: 1, // only 1 user can join with this link (prevents share abuse)
      expire_date: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * TELEGRAM_INVITE_EXPIRE_DAYS) // expires after X days
    })
  });

  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Telegram API error: ${JSON.stringify(data)}`);
  }
  return data.result.invite_link;
}
