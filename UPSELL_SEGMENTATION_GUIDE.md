# Upsell Segmentation System

## How It Works

The system tracks which upsells buyers select and automatically adds them to the appropriate Zoho segmentation list. This is done by passing an `upsellsSelected` array through the purchase flow.

## Upsell Structure

### Core Offer - $97
"How to create a sales conversion system that makes your customers spend 3x-8x more"

### Upsell #1 (Modal) - $48
**High-Converting VSL Masterclass**
- ID: `vsl_course`
- Learn video sales letters that convert at 5-10%

### Upsell #2 (Modal) - $98  
**Irresistible Offers Course**
- ID: `offers_course`
- Create offers people can't say no to

### Upsell #3 (VSL Page) - $97 or $297
**Complete YouTube Ads Dominance Course**
- ID: `youtube_ads`
- Price depends on timer ($97 if within 10 min, $297 after)

## All 8 Possible Combinations

| Combination | Upsells Selected | Zoho List Key |
|------------|------------------|---------------|
| Core only | `[]` | `BOUGHT_CORE_OFFER_ONLY_LIST_KEY` |
| Core + VSL | `['vsl_course']` | `BOUGHT_VSL_COURSE_ONLY_LIST_KEY` |
| Core + Offers | `['offers_course']` | `BOUGHT_OFFERS_COURSE_ONLY_LIST_KEY` |
| Core + YouTube | `['youtube_ads']` | `BOUGHT_YOUTUBE_ADS_ONLY_LIST_KEY` |
| Core + VSL + Offers | `['vsl_course', 'offers_course']` | `BOUGHT_VSL_AND_OFFERS_LIST_KEY` |
| Core + VSL + YouTube | `['vsl_course', 'youtube_ads']` | `BOUGHT_VSL_AND_YOUTUBE_LIST_KEY` |
| Core + Offers + YouTube | `['offers_course', 'youtube_ads']` | `BOUGHT_OFFERS_AND_YOUTUBE_LIST_KEY` |
| All 3 upsells | `['vsl_course', 'offers_course', 'youtube_ads']` | `BOUGHT_ALL_UPSELLS_LIST_KEY` |

## Setup in Zoho Campaigns

1. **Create these 8 lists in Zoho:**
   - Core Offer Only
   - VSL Course Only  
   - Offers Course Only
   - YouTube Ads Only
   - VSL + Offers
   - VSL + YouTube
   - Offers + YouTube
   - All Upsells

2. **Get each list's key** (the long alphanumeric string from Zoho)

3. **Add to `.env` file:**
```bash
BOUGHT_CORE_OFFER_ONLY_LIST_KEY=your_core_only_list_key
BOUGHT_VSL_COURSE_ONLY_LIST_KEY=your_vsl_course_only_key
BOUGHT_OFFERS_COURSE_ONLY_LIST_KEY=your_offers_course_only_key
BOUGHT_YOUTUBE_ADS_ONLY_LIST_KEY=your_youtube_ads_only_key
BOUGHT_VSL_AND_OFFERS_LIST_KEY=your_vsl_and_offers_key
BOUGHT_VSL_AND_YOUTUBE_LIST_KEY=your_vsl_and_youtube_key
BOUGHT_OFFERS_AND_YOUTUBE_LIST_KEY=your_offers_and_youtube_key
BOUGHT_ALL_UPSELLS_LIST_KEY=your_all_upsells_key
```

## How It's Tracked

**Step 1: Modal Upsells (ebookBuy.js)**
- When buyer clicks modal checkboxes, we track which they selected
- Creates `upsellsSelected` array: `['vsl_course']`, `['offers_course']`, or both
- Stored in sessionStorage and passed to VSL page

**Step 2: VSL Page (upsell-vsl.js)**
- If buyer accepts YouTube ads, adds `'youtube_ads'` to the array
- Final array passed to backend in payment request

**Step 3: Backend (server.js)**
- Stores `upsellsSelected` in order record
- On payment success, calls `getZohoSegmentationList(upsellsSelected)`
- Returns the appropriate list key based on combination
- Adds buyer to BOTH:
  1. Main paid list (PAID_BEFORE or PAID_AFTER based on timer)
  2. Segmentation list (based on upsells selected)

## Why This is Better Than Price-Based

✅ **Change prices anytime** - segmentation still works  
✅ **Clear and explicit** - know exactly what they bought  
✅ **No math errors** - don't need to calculate all price combinations  
✅ **Future-proof** - add new upsells without breaking logic  
✅ **YouTube timer proof** - YouTube can be $97 or $297, still tracked as same upsell  

## Testing

1. Test each combination by selecting different upsells
2. Check server logs: should see `"Adding buyer to segmentation list: [KEY]"` 
3. Verify in Zoho that buyer appears in correct list
4. Check they're in BOTH main paid list AND segmentation list

## Email Marketing Strategy

Now you can send targeted emails:

- **Core only buyers**: "You left money on the table - here's what you missed"
- **VSL only**: Cross-sell Offers course
- **Offers only**: Cross-sell VSL course  
- **YouTube only**: "Get the full system - VSL + Offers bundle"
- **VSL + Offers**: "Complete your arsenal with YouTube Ads"
- **Any combo without YouTube**: "Scale with paid traffic"
- **All 3 buyers**: VIP content, advanced training, affiliate offers
