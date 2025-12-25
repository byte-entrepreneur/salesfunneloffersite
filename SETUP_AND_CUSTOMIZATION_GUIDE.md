# Complete Setup & Customization Guide

This guide will walk you through setting up your sales funnel from scratch and customizing it to match your brand and offers.

---

## Table of Contents

1. [Initial Setup](#initial-setup)
2. [Appwrite Database Setup](#appwrite-database-setup)
3. [Zoho Campaigns Setup](#zoho-campaigns-setup)
4. [Paystack Payment Setup](#paystack-payment-setup)
5. [Environment Variables Configuration](#environment-variables-configuration)
6. [Customization Guide](#customization-guide)
   - [Prices](#prices)
   - [Timer Durations](#timer-durations)
   - [Button Show Times](#button-show-times)
   - [Colors & Branding](#colors--branding)
   - [Copy & Text Content](#copy--text-content)
7. [Testing Your Setup](#testing-your-setup)
8. [Deployment](#deployment)

---

## Initial Setup

### Prerequisites

Before you begin, make sure you have:
- Node.js installed (v14 or higher)
- A code editor (VS Code recommended)
- Git installed
- A terminal/command prompt

### Clone and Install

1. **Clone the repository:**
   ```bash
   git clone https://github.com/byte-entrepreneur/salesfunneloffersite.git
   cd salesfunneloffersite
   ```

2. **Install dependencies:**
   ```bash
   npm install
   # or if you use pnpm
   pnpm install
   ```

---

## Appwrite Database Setup

Appwrite is used to store order information and customer data.

### Step 1: Create Appwrite Account

1. Go to [https://cloud.appwrite.io/](https://cloud.appwrite.io/)
2. Click "Sign Up" and create a free account
3. Verify your email address

### Step 2: Create a Project

1. Once logged in, click "Create Project"
2. Enter a project name (e.g., "Sales Funnel")
3. Click "Create"
4. Copy your **Project ID** - you'll need this later

### Step 3: Get API Key

1. In your project, go to "Settings" → "API Keys"
2. Click "Create API Key"
3. Name it (e.g., "Backend Server Key")
4. Set scopes to include:
   - `databases.read`
   - `databases.write`
   - `collections.read`
   - `collections.write`
   - `documents.read`
   - `documents.write`
   - `attributes.read`
   - `attributes.write`
5. Click "Create"
6. Copy your **API Key** (you won't see it again!)

### Step 4: Create Database

1. Go to "Databases" in the left sidebar
2. Click "Create Database"
3. Name it `ordersDB`
4. Copy the **Database ID** that appears

### Step 5: Create "orders" Collection

1. Inside your database, click "Create Collection"
2. Name it `orders`
3. Set Collection ID to `68002716000700b397cf` (or use your own and update in code)
4. Click "Create"

### Step 6: Add Attributes to "orders" Collection

Click "Create Attribute" for each field below:

| Attribute Key | Type | Size | Required | Default |
|--------------|------|------|----------|---------|
| `email` | String | 255 | Yes | - |
| `firstName` | String | 100 | Yes | - |
| `lastName` | String | 100 | Yes | - |
| `orderReference` | String | 255 | Yes | - |
| `orderDetails` | String | 10000 | Yes | - |
| `upsellsSelected` | String | 500 | No | - |
| `boughtWithinOfferWindow` | Boolean | - | No | - |
| `zohoSynced` | Boolean | - | No | false |
| `zohoSyncedListKey` | String | 100 | No | - |
| `purchasedBeforeDeadline` | Boolean | - | No | - |
| `countdownStartTime` | Integer | - | No | - |
| `countdownDurationMinutes` | Integer | - | No | - |

**Important:** After adding all attributes, go to "Settings" → "Update Permissions" and set:
- **Create Documents**: Anyone
- **Read Documents**: Anyone  
- **Update Documents**: Anyone
- **Delete Documents**: Anyone

(For production, you should restrict these to specific roles/users)

### Step 7: Create "signups" Collection

1. Create another collection named `signups`
2. Set Collection ID to `68ea5643000df7082df9` (or use your own and update in code)
3. Add these attributes:

| Attribute Key | Type | Size | Required |
|--------------|------|------|----------|
| `email` | String | 255 | Yes |
| `firstName` | String | 100 | Yes |
| `lastName` | String | 100 | Yes |
| `zohoSynced` | Boolean | - | No |

4. Set the same permissions as the orders collection

---

## Zoho Campaigns Setup

Zoho Campaigns is used for email marketing and segmentation.

### Step 1: Create Zoho Account

1. Go to [https://www.zoho.com/campaigns/](https://www.zoho.com/campaigns/)
2. Sign up for a free account
3. Verify your email

### Step 2: Create Mailing Lists

You need to create 10 mailing lists for segmentation:

**Timing-Based Lists:**
1. `PAID_BEFORE` - Customers who bought within countdown window
2. `PAID_AFTER` - Customers who bought after countdown expired

**Upsell Combination Lists:**
3. `VSL_ONLY` - Bought VSL upsell only
4. `PERSONAL_COACHING_ONLY` - Bought coaching only
5. `BOTH_VSL_AND_PERSONAL_COACHING` - Bought both upsells
6. `YOUTUBE_ADS_ONLY` - Bought YouTube ads course only
7. `VSL_AND_YOUTUBE_ADS` - Bought VSL + YouTube
8. `PERSONAL_COACHING_AND_YOUTUBE_ADS` - Bought coaching + YouTube
9. `ALL_THREE_UPSELLS` - Bought all three upsells
10. `NO_UPSELLS` - Bought only the main ebook

**To create each list:**
1. Go to "Contacts" → "Mailing Lists"
2. Click "Create Mailing List"
3. Enter the list name exactly as shown above
4. Click "Create"
5. **Copy the List Key** that appears in the URL (e.g., `4fz9e123456789abcdef`)

### Step 3: Get Zoho API Credentials

1. Go to [https://api-console.zoho.com/](https://api-console.zoho.com/)
2. Click "Get Started"
3. Choose "Server-based Applications"
4. Fill in:
   - **Client Name**: Your app name (e.g., "Sales Funnel")
   - **Homepage URL**: `http://localhost:3000`
   - **Authorized Redirect URIs**: `http://localhost:3000/zoho/callback`
5. Click "Create"
6. Copy your **Client ID** and **Client Secret**

### Step 4: Generate Refresh Token

1. Open this URL in your browser (replace `YOUR_CLIENT_ID`):
   ```
   https://accounts.zoho.com/oauth/v2/auth?scope=ZohoCampaigns.contact.ALL&client_id=YOUR_CLIENT_ID&response_type=code&access_type=offline&redirect_uri=http://localhost:3000/zoho/callback
   ```

2. Authorize the app
3. You'll be redirected to a URL with a `code` parameter - copy this code
4. Run this command in terminal (replace placeholders):
   ```bash
   curl -X POST https://accounts.zoho.com/oauth/v2/token \
     -d "code=YOUR_CODE" \
     -d "client_id=YOUR_CLIENT_ID" \
     -d "client_secret=YOUR_CLIENT_SECRET" \
     -d "redirect_uri=http://localhost:3000/zoho/callback" \
     -d "grant_type=authorization_code"
   ```

5. Copy the **refresh_token** from the response

### Step 5: Map List Keys

Open your code and update the `ZOHO_LIST_KEYS` object in `server.js` with your actual list keys:

```javascript
const ZOHO_LIST_KEYS = {
  PAID_BEFORE: '4fz9e123456789abcdef',           // Replace with your list key
  PAID_AFTER: '4fz9e987654321fedcba',            // Replace with your list key
  VSL_ONLY: '4fz9e111111111111111',              // Replace with your list key
  PERSONAL_COACHING_ONLY: '4fz9e222222222222',   // Replace with your list key
  BOTH_VSL_AND_PERSONAL_COACHING: '4fz9e333333', // Replace with your list key
  YOUTUBE_ADS_ONLY: '4fz9e444444444444',         // Replace with your list key
  VSL_AND_YOUTUBE_ADS: '4fz9e555555555555',      // Replace with your list key
  PERSONAL_COACHING_AND_YOUTUBE_ADS: '4fz9e666', // Replace with your list key
  ALL_THREE_UPSELLS: '4fz9e777777777777',        // Replace with your list key
  NO_UPSELLS: '4fz9e888888888888'                // Replace with your list key
};
```

---

## Paystack Payment Setup

Paystack is used to process payments.

### Step 1: Create Paystack Account

1. Go to [https://paystack.com/](https://paystack.com/)
2. Click "Sign Up"
3. Complete the registration
4. Verify your email

### Step 2: Get API Keys

1. Log in to your Paystack dashboard
2. Go to "Settings" → "API Keys & Webhooks"
3. Copy your **Test Public Key** (starts with `pk_test_`)
4. Copy your **Test Secret Key** (starts with `sk_test_`)

### Step 3: Set Up Webhook

1. In Paystack dashboard, go to "Settings" → "API Keys & Webhooks"
2. Scroll to "Webhook URL"
3. Enter your server URL + `/api/paystack-webhook`
   - For local testing with ngrok: `https://your-ngrok-url.ngrok-free.app/api/paystack-webhook`
   - For production: `https://yourdomain.com/api/paystack-webhook`
4. Click "Save"

### Step 4: Go Live (When Ready)

When ready for production:
1. Complete Paystack KYC verification
2. Switch to **Live Public Key** and **Live Secret Key**
3. Update webhook URL to production domain

---

## Environment Variables Configuration

### Step 1: Create .env File

In the root directory, create a `.env` file:

```bash
cp .env.example .env
```

### Step 2: Fill in Your Credentials

Open `.env` and fill in all the values you collected:

```env
# Appwrite Configuration
APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=your_project_id_here
APPWRITE_API_KEY=your_api_key_here
APPWRITE_DATABASE_ID=your_database_id_here
APPWRITE_ORDERS_COLLECTION_ID=68002716000700b397cf
APPWRITE_SIGNUPS_COLLECTION_ID=68ea5643000df7082df9

# Zoho Campaigns Configuration
ZOHO_CLIENT_ID=your_zoho_client_id_here
ZOHO_CLIENT_SECRET=your_zoho_client_secret_here
ZOHO_REFRESH_TOKEN=your_zoho_refresh_token_here
ZOHO_API_DOMAIN=https://campaigns.zoho.com

# Paystack Configuration
PAYSTACK_SECRET_KEY=sk_test_your_secret_key_here
PAYSTACK_PUBLIC_KEY=pk_test_your_public_key_here

# Server Configuration
PORT=3000
NODE_ENV=development

# Frontend URL
FRONTEND_URL=http://localhost:3000
```

### Step 3: Update Frontend Paystack Key

Open `public/ebookBuy.js` and update the Paystack public key around line 340:

```javascript
key: 'pk_test_your_public_key_here', // Replace with your actual Paystack public key
```

Do the same in `public/upsell-vsl.js` around line 110.

---

## Customization Guide

### Prices

#### Main Ebook Price

**File:** `public/ebookBuy.js`

**Line ~39:** Update the price display
```javascript
<p class="text-4xl font-bold text-green-400 mb-2">$37</p>
```

**Line ~308:** Update the amount sent to Paystack (in kobo/cents)
```javascript
amount: 3700, // Amount in kobo (37 USD = 3700 kobo)
```

#### VSL Upsell Price

**File:** `public/upsell-vsl.js`

**Initial Price (Line ~28):**
```javascript
<p class="text-4xl font-bold text-green-400 mb-2">$97</p>
```

**Increased Price After Timer (Line ~30):**
```javascript
<p class="text-4xl font-bold text-red-400 line-through">$297</p>
```

**Line ~95:** Update amount for Paystack
```javascript
amount: currentPrice * 100, // Convert to kobo/cents
```

**Line ~42-44:** Update price change logic
```javascript
let currentPrice = 97; // Initial price
// Later in code
currentPrice = 297; // Price after timer expires
```

#### Personal Coaching Upsell Price

**File:** `public/ebookBuy.js`

**Line ~54:** Update modal display price
```javascript
<p class="text-2xl font-bold text-green-400 mb-2">$297</p>
```

**Line ~315:** Update upsell details object
```javascript
upsells: {
  personalCoaching: { selected: true, price: 297 },
  // ...
}
```

#### YouTube Ads Upsell Price

**File:** `public/upsell-vsl.js`

**Line ~50:** Update checkbox label price
```javascript
<span class="text-green-400 font-bold ml-2">+ $197</span>
```

**Line ~103:** Update upsell calculation
```javascript
if (youtubeCheckbox.checked) {
  totalAmount += 19700; // $197 in kobo
}
```

---

### Timer Durations

#### Main Countdown Timer (Offer Window)

**File:** `public/ebookBuy.js`

**Line ~431:** Change the countdown duration
```javascript
const expiryMinutes = 5; // Change to desired minutes (e.g., 10, 15, 30)
```

This timer determines if customers go to `PAID_BEFORE` or `PAID_AFTER` lists.

#### VSL Page Timer (Price Increase)

**File:** `public/upsell-vsl.js`

**Line ~190:** Change when price increases
```javascript
let timeRemaining = 10 * 60; // 10 minutes in seconds
```

Change `10` to your desired minutes. This only affects the price increase, NOT the segmentation.

---

### Button Show Times

#### Show Modal Button Delay

**File:** `public/ebookBuy.js`

**Line ~460:** Change when "See What's Inside" button appears
```javascript
setTimeout(() => {
  showModalBtn.classList.remove('hidden');
}, 3000); // 3000ms = 3 seconds
```

Change `3000` to your desired delay in milliseconds:
- 5 seconds = `5000`
- 10 seconds = `10000`
- 30 seconds = `30000`

#### Countdown Start Delay

**File:** `public/ebookBuy.js`

**Line ~429:** Change when countdown timer starts
```javascript
setTimeout(() => {
  startCountdown();
}, 2000); // 2000ms = 2 seconds after page load
```

---

### Colors & Branding

All color customization is in the HTML files using Tailwind CSS classes.

#### Primary Color (Green)

**Files:** `public/ebookBuy.html`, `public/upsell-vsl.html`, `public/thankyou-order.html`

Find and replace these Tailwind classes:

| Current Class | Change To | Effect |
|--------------|-----------|--------|
| `bg-green-600` | `bg-blue-600` | Blue background |
| `text-green-400` | `text-blue-400` | Blue text |
| `border-green-500` | `border-blue-500` | Blue border |

**Available Tailwind colors:**
- `red`, `blue`, `purple`, `pink`, `indigo`, `yellow`, `orange`, `teal`, `cyan`

**Shades:** 100 (lightest) to 900 (darkest)

#### Background Colors

**File:** `public/ebookBuy.html`

**Line ~12:** Main background
```html
<body class="bg-gray-900 text-white min-h-screen">
```

Change `bg-gray-900` to:
- `bg-black` - Pure black
- `bg-slate-900` - Slate black
- `bg-zinc-900` - Zinc black

**Card backgrounds:**
```html
<div class="bg-gray-800 rounded-lg shadow-xl p-8">
```

Change `bg-gray-800` to lighter/darker shades (700, 900, etc.)

#### Text Colors

**Headings:** Change `text-white` to `text-gray-100`, `text-blue-100`, etc.

**Subheadings:** Change `text-gray-300` to other shades

**Accent text:** Change `text-green-400` to your brand color

---

### Copy & Text Content

#### Landing Page Headlines

**File:** `public/ebookLandingPage.html`

**Main Headline:**
```html
<h1 class="text-5xl font-bold mb-4">
  Your Main Headline Here
</h1>
```

**Subheadline:**
```html
<p class="text-xl mb-8">
  Your compelling subheadline goes here
</p>
```

#### Main Product Page

**File:** `public/ebookBuy.html`

**Product Title (Line ~36):**
```html
<h2 class="text-3xl font-bold mb-4">
  Freedom Trader's Blueprint
</h2>
```

**Description (Line ~38):**
```html
<p class="text-gray-300 mb-6">
  Your product description here. Make it compelling!
</p>
```

**Features List (Line ~75-85):**
```html
<ul class="space-y-2 mb-6">
  <li class="flex items-start">
    <svg>...</svg>
    <span>Feature 1: Your benefit here</span>
  </li>
  <li>Feature 2: Another benefit</li>
  <!-- Add more features -->
</ul>
```

#### Button Text

**Main CTA Button:**
```html
<button class="...">
  Get Instant Access - $37
</button>
```

**Upsell Button:**
```html
<button class="...">
  Yes! Add This To My Order
</button>
```

#### Upsell Modal Content

**File:** `public/ebookBuy.js`

**Line ~51-58:** Update upsell offer text
```javascript
<h3 class="text-2xl font-bold mb-4">
  🎯 Your Upsell Headline Here
</h3>
<p class="text-gray-300 mb-4">
  Explain what they get with this upsell...
</p>
```

#### VSL Page Copy

**File:** `public/upsell-vsl.html`

**Line ~24-32:** Update the video sales letter content
```html
<h2 class="text-3xl font-bold mb-4">
  Special One-Time Offer
</h2>
<p class="text-xl text-gray-300 mb-6">
  Your VSL copy here...
</p>
```

#### Thank You Page

**File:** `public/thankyou-order.html`

**Success Message (Line ~21):**
```html
<h1 class="text-4xl font-bold mb-4">
  🎉 Thank You For Your Purchase!
</h1>
<p class="text-xl text-gray-300 mb-8">
  Check your email for access instructions...
</p>
```

---

## Testing Your Setup

### Local Testing

1. **Start the server:**
   ```bash
   npm start
   # or
   pnpm start
   ```

2. **Open in browser:**
   ```
   http://localhost:3000/ebookLandingPage.html
   ```

3. **Test the flow:**
   - Sign up for the ebook
   - Complete a test purchase
   - Check upsell pages
   - Verify thank you page

### Test Appwrite

1. Go to your Appwrite dashboard
2. Navigate to Databases → ordersDB → orders collection
3. You should see test orders appearing

### Test Zoho Sync

1. Go to Zoho Campaigns
2. Check your mailing lists
3. Test contacts should appear in appropriate lists

### Test Paystack

1. Use Paystack test card: `4084084084084081`
2. CVV: Any 3 digits
3. Expiry: Any future date
4. Pin: `0000`

---

## Deployment

### Option 1: Deploy to Heroku

1. **Install Heroku CLI**
2. **Login:**
   ```bash
   heroku login
   ```

3. **Create app:**
   ```bash
   heroku create your-app-name
   ```

4. **Set environment variables:**
   ```bash
   heroku config:set APPWRITE_PROJECT_ID=your_value
   heroku config:set ZOHO_CLIENT_ID=your_value
   # ... set all env vars
   ```

5. **Deploy:**
   ```bash
   git push heroku main
   ```

### Option 2: Deploy to Vercel

1. **Install Vercel CLI:**
   ```bash
   npm i -g vercel
   ```

2. **Deploy:**
   ```bash
   vercel
   ```

3. **Add environment variables** in Vercel dashboard

### Option 3: Deploy to Railway

1. Go to [railway.app](https://railway.app)
2. Click "New Project"
3. Connect your GitHub repo
4. Add environment variables
5. Deploy

### Update Webhook URLs

After deployment, update:
1. **Paystack webhook URL** to your production domain
2. **Zoho redirect URI** to your production domain
3. **Frontend URLs** in all files to production domain

---

## Common Issues & Solutions

### Issue: Countdown not working
**Solution:** Check that `countdownStartTime` is being stored in sessionStorage in `ebookBuy.js`

### Issue: Payments not processing
**Solution:** Verify your Paystack keys are correct and you're using test keys for testing

### Issue: Zoho sync failing
**Solution:** Check your refresh token is valid. You may need to regenerate it.

### Issue: Orders not saving to Appwrite
**Solution:** Verify collection IDs match your Appwrite setup and permissions are set correctly

### Issue: Wrong segmentation list
**Solution:** Check the timer duration and countdown calculation logic in `server.js`

---

## Support

If you need help:
1. Check the error logs in your terminal
2. Check browser console for frontend errors
3. Review this guide carefully
4. Check Appwrite/Zoho/Paystack documentation

---

## Next Steps

1. ✅ Complete all setup steps above
2. ✅ Test locally with test data
3. ✅ Customize colors and copy
4. ✅ Test payment flow end-to-end
5. ✅ Verify email segmentation
6. ✅ Deploy to production
7. ✅ Update webhook URLs
8. ✅ Switch to live payment keys
9. ✅ Test production environment
10. ✅ Launch and monitor!

---

**Good luck with your sales funnel! 🚀**
