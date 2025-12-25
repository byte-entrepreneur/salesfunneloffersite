# Freedom Trader Backend — README


This repository contains the backend for the Freedom Trader landing pages and payment flow. The server is an Express app that:

- Serves static landing pages from `public/` (so frontend and API can share origin).
- Provides endpoints for signup, session start, heartbeats, initiating payments (Paystack), and payment webhook/callback handlers.
- Integrates with Appwrite for persistence and Zoho Campaigns for contact management.

This README documents required environment variables, the main architecture and endpoints, local development, and recommended deployment options (including Vercel). It also explains cookie/CORS settings for same-origin vs cross-origin deployments.

---

## Recent updates

- Client heartbeats have been removed: the frontend no longer emits periodic calls to `/api/signup-heartbeat`. The server now relies on explicit events only (`/api/start` on page load and payment initiation/confirmation) and uses the httpOnly `signupId` cookie to correlate timing and compute "time spent" values.
- Crypto payment UI: `Pay with Crypto` dropdown and modal were added to the checkout page. Each modal shows the network, a warning, the wallet address, and a `Copy` button that copies the address to the clipboard and shows a brief toast.
- Unconfirmed payment tracking: Added "Confirm Payment" buttons to crypto and other payment method modals. When clicked, the user's email is sent to a dedicated "unconfirmed payment" Zoho list for manual follow-up.
- Debug UI elements (debug badge and eligibility dot) were removed from the public page.


## Quick .env keys (complete list)

Below are all environment variable keys used by the backend. Provide the ones relevant to your deployment. Keys with defaults are noted.

- APPWRITE_ENDPOINT (optional) — Appwrite endpoint. Default: `https://cloud.appwrite.io/v1` if omitted.
- APPWRITE_PROJECT_ID — Appwrite project id (required if using Appwrite).
- APPWRITE_API_KEY — Appwrite API key with permission to read/write the configured collections (required if using Appwrite).
- ORDERS_DATABASE_ID — (optional) Database id for orders (defaults to `ordersDB`).
- ORDERS_COLLECTION_ID — (required) Collection id for orders in Appwrite.
- SIGNUPS_DATABASE_ID — (optional) Database id for signups (defaults to `signups`).
- SIGNUPS_COLLECTION_ID — (required) Collection id for signups in Appwrite.
- FRONTEND_BASE_URL — (optional but recommended) Full frontend origin (e.g., `https://www.example.com`). Used to enable cross-origin cookie/CORS when frontend is hosted on a different origin.
- BACKEND_BASE_URL — (optional) Full backend origin (e.g., `https://api.example.com`). Used only for origin comparisons when provided.
- DEFAULT_PRICE — (optional) Default price used when `initiate-payment` call omits amount. Default: `1000000` (1,000,000 Naira). The server converts Naira to kobo by multiplying by 100 for Paystack.
- MIN_WATCH_MINUTES or MIN_WATCH_MINUTES_DEFAULT — (optional) Minutes threshold for marking a visitor eligible for the ebook. Default: `0.5` (30 seconds).
- PAYSTACK_CALLBACK_URL — (required for Paystack) Callback/redirect URL you provided to Paystack initialization (frontend thank-you redirect target).
- PAYSTACK_SECRET_KEY — (required) Paystack secret key used for transaction initialization and verification.
- NODE_ENV — `production` or `development`. Affects cookie `secure` flag.
- PORT — (optional) Port to run the server locally (default is provided in `index.js` if not set).

### Zoho-related env keys
- ZOHO_REFRESH_TOKEN — (optional) Use this to refresh Zoho access token without Appwrite storage.
- ZOHO_CLIENT_ID — Required if Zoho integration is used via stored refresh tokens.
- ZOHO_CLIENT_SECRET — Required if Zoho integration is used via stored refresh tokens.

### Zoho list keys / feature list mapping
- MAIN_LIST_KEY — (optional) Zoho list key used for initial signups / click events.
- PAID_BEFORE_LIST_KEY — (optional) Zoho list key for purchasers who bought before the deadline.
- PAID_AFTER_LIST_KEY — (optional) Zoho list key for purchasers who bought after the deadline.
- ELIGIBLE_EBOOK_LIST_KEY — (optional) Alias used for marking eligible visitors.
- PAID_LIST_KEY — (optional) Fallback Zoho list used when others are not configured.
- UNCONFIRMED_PAYMENT_LIST_KEY — (optional) Zoho list key for users who clicked "Confirm Payment" on crypto/other payment methods.

Notes:
- If you don't use Appwrite you can still run parts of the server, but many features (persistence of signups, orders, Zoho token storage) rely on Appwrite.
- If you plan to host frontend and backend under the same origin (recommended), you can omit `FRONTEND_BASE_URL` and the backend will use permissive `Access-Control-Allow-Origin: *` and `SameSite: Lax` cookies (no CORS credentials needed).

---

## Architecture & Flow

High-level flow:

1. Visitor opens landing page (served from `public/ebookLandingPage.html`).
2. Frontend calls `POST /api/start` (added for server-side sessions) which creates a server-side session document in the signups collection and sets an httpOnly cookie `signupId`.
3. Previously the frontend sent periodic heartbeats to `POST /api/signup-heartbeat` (server read `signupId` from cookie) to update `lastSeenAt` and compute eligibility. That behavior has been removed — the client no longer emits heartbeats. The server now uses explicit events only and computes timings using the httpOnly `signupId` cookie.
4. When visitor clicks Buy, frontend calls `POST /api/initiate-payment` (server finds session/signup by cookie or email, computes timeSpentBeforeInitiateMs, initializes Paystack transaction and saves an order with `paystackReference`).
5. Paystack redirects browser to callback URL and/or sends webhook to `/api/paystack-webhook`. The server verifies the payment, computes timeSpentUntilPaidMs (from associated signup record), and marks the order as paid.
6. On eligibility or purchase, the server contacts Zoho Campaigns via `zohoAPIUpdate` to move/subscribe the contact into appropriate lists.

Key files:
- `server.js` — main Express server, endpoints, cookie handling, CORS logic.
- `public/ebookLandingPage.html` — landing page with client-side code that calls `/api/start` and heartbeats (already injected).
- `zohoTokenUtils.js` — helper to fetch or refresh Zoho OAuth tokens (reads env or Appwrite-stored tokens).

---

## Endpoints (summary)

- GET `/` — serves `ebookLandingPage.html`.
- POST `/api/start` — Create a short-lived session/signup document (stores `pageEnterAt`) and sets an httpOnly `signupId` cookie. Call on page load.
- POST `/api/subscribe` — Traditional signup endpoint (name, email, phone). Also writes a signup doc and sets cookie.
- POST `/api/signup-heartbeat` — Client heartbeat (best-effort) to update `lastSeenAt` and compute eligibility. Client sends `{ pageEnterAt }` in body (optional) but server reads session cookie.
- GET `/api/signup-status` — Returns eligibility and timeSpent for a signup (uses cookie or ?signupId or ?email fallback).
- POST `/api/initiate-payment` — Initialize Paystack transaction, create order with `paystackReference`. Server tries to compute timeSpentBeforeInitiateMs from signup record.
- POST `/api/confirm-unconfirmed-payment` — Adds user email to unconfirmed payment Zoho list when they click "Confirm Payment" on crypto/other payment methods.
- POST `/api/paystack-webhook` — Paystack webhook verification and order update. Uses `X-Paystack-Signature` HMAC check.
- GET `/api/paystack-callback` — Paystack redirect verification + redirect to frontend thank-you page.

---

## Local development

1. Install dependencies:

```powershell
cd backend
npm install
```

2. Create a `.env` file in `backend/` containing at least the Appwrite and Paystack keys if you plan to test the full flow. Minimum recommended for local testing (replace values):

```
APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=your_appwrite_project_id
APPWRITE_API_KEY=your_appwrite_api_key
ORDERS_COLLECTION_ID=your_orders_collection_id
SIGNUPS_COLLECTION_ID=your_signups_collection_id
PAYSTACK_SECRET_KEY=sk_test_xxx
PAYSTACK_CALLBACK_URL=http://localhost:3000/thankyou.html
FRONTEND_BASE_URL=http://localhost:3000   # set this in cross-origin tests
BACKEND_BASE_URL=http://localhost:4000
NODE_ENV=development
```

3. Start server:

```powershell
npm start
```

4. Open `http://localhost:3000/` (or the configured port). The landing page will call `/api/start`. (Client heartbeat calls have been removed.)

Notes for local cookie testing:
- If your frontend and backend are on different ports (e.g., `localhost:3000` and `localhost:4000`), set `FRONTEND_BASE_URL` and `BACKEND_BASE_URL` and the server will enable credentialed CORS and set cookie SameSite to `None`. For local http testing, cookies with `secure:true` won't work — `NODE_ENV=development` leaves `secure` as false.

---

## Deployment

Two recommended deployments:

### A) Same-origin (recommended, simplest)
- Host frontend and backend under the same domain. If you use Vercel with Next.js, move the server logic into Next.js API routes so the entire site and APIs are under `https://www.example.com`.
- Benefits: no CORS; cookies use `SameSite: Lax`; simpler configuration.

### B) Frontend on Vercel, backend on separate host (subdomain) — cross-origin but workable
- Example: frontend `https://www.example.com` (Vercel), backend `https://api.example.com` (any host).
- Set environment variables on your backend host:
  - `FRONTEND_BASE_URL=https://www.example.com`
  - `BACKEND_BASE_URL=https://api.example.com`
- Server will detect cross-origin and automatically use `Access-Control-Allow-Origin: https://www.example.com` and `Access-Control-Allow-Credentials: true`.
- When setting cookies, the server will use `SameSite=None` and `Secure:true` (in production). To share cookie across subdomains set cookie `domain: '.example.com'` if you want the cookie sent to both `www` and `api`.
- Frontend must include credentials on fetch:

```js
fetch('https://api.example.com/api/signup-heartbeat', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageEnterAt }) });
```

Notes:
- For production cross-site cookies you must serve over HTTPS and set `SameSite=None; Secure`.
- If using Vercel functions for API, prefer same-origin approach by using Next.js API routes.

---

## Webhook & testing tips

- To test Paystack webhooks locally, tools like `ngrok` are useful. Expose your local backend to the internet, register the ngrok URL in Paystack dashboard as the webhook endpoint, and forward to `/api/paystack-webhook`.
- Webhook verification uses `X-Paystack-Signature`. Ensure `PAYSTACK_SECRET_KEY` is the same in your `.env` and in Paystack dashboard settings.

---

## Security & best practices

- Keep secrets (Appwrite keys, Paystack secret, Zoho client secret) out of source control. Use platform env settings for deployments (Vercel, Heroku, etc.).
- Use httpOnly cookies for session ids (we set `signupId` as httpOnly). This prevents JS from reading/modifying the value.
- For cross-origin cookies, use `SameSite=None` + `Secure:true` and only allow your trusted frontend origin in CORS.
- Validate and sanitize incoming user input (server already validates email/phone lightly). Consider stricter validation for production.
- Rotate Zoho and Paystack secrets periodically.

---

## Troubleshooting

- Cookie not set in browser: ensure you are using HTTPS for SameSite=None cookies and that CORS `credentials` is enabled and frontend uses `credentials: 'include'`.
- Webhook returns 401: verify the HMAC header `X-Paystack-Signature` is computed using the same secret key configured in your Paystack dashboard and your `.env`.
- Appwrite `createDocument` / `listDocuments` failing: verify `APPWRITE_API_KEY`, project id, and collection ids.

---

If you want, I can:
- Add a `README.md` to the project root summarizing repo-level info and how the backend fits into the full stack.
- Add a `Makefile`/scripts for running `dev`, `start`, and `test` commands.
- Implement server-side change to set cookie domain (e.g., `.example.com`) for subdomain sharing.

Would you like me to also create a repo-root README, or adjust cookie-domain behavior now?
