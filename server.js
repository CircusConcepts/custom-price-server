import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

const app = express();
app.use(express.json());
dotenv.config();

const SHOP = process.env.SHOPIFY_SHOP;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN; // Admin API access token
const VARIANT_POOL = (process.env.CUSTOM_VARIANT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

// ---- Pricing logic (mirror your theme rules) ----
function computePrice(lengthM) {
  if (isNaN(lengthM) || lengthM <= 0) return { ok: false, error: 'Invalid length' };
  if (lengthM < 5.5 || lengthM > 15) return { ok: false, error: 'Out of supported range' };

  const basePrice = 579.99;
  let price = null;

  if (lengthM >= 5.5 && lengthM <= 7)      price = basePrice - 45;
  else if (lengthM > 7 && lengthM <= 8)    price = basePrice;
  else if (lengthM > 8 && lengthM <= 10)   price = 669.99;
  else if (lengthM > 10 && lengthM <= 11)  price = basePrice + 180;
  else if (lengthM > 11 && lengthM <= 12)  price = basePrice + 230;
  else if (lengthM > 12 && lengthM <= 13)  price = basePrice + 280;
  else if (lengthM > 13 && lengthM <= 14)  price = basePrice + 330;
  else if (lengthM > 14 && lengthM <= 15)  price = basePrice + 380;

  if (price == null) return { ok: false, error: 'No price tier found' };
  return { ok: true, price: Number(price.toFixed(2)) };
}

// Round-robin variant from pool
let rrIndex = 0;
function pickVariantId() {
  if (!VARIANT_POOL.length) throw new Error('No variant IDs in pool');
  const id = VARIANT_POOL[rrIndex % VARIANT_POOL.length];
  rrIndex++;
  return id;
}

// CORS for your storefront origin(s)
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  const allowed = [
    /\.myshopify\.com$/i,
    /circusconcepts\.com$/i,
    /\.shopifypreview\.com$/i, // theme preview
  ];
  if (allowed.some(rx => rx.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// POST /api/custom-price
app.post('/api/custom-price', async (req, res) => {
  try {
    const { length_m, feet, inches } = req.body || {};
    let lengthM = Number(length_m);

    // Support imperial input
    if ((!lengthM || isNaN(lengthM)) && (feet != null || inches != null)) {
      const f = Number(feet) || 0;
      const i = Number(inches) || 0;
      lengthM = f * 0.3048 + i * 0.0254;
    }

    const result = computePrice(lengthM);
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    const variantId = pickVariantId();
    const newPrice = result.price.toFixed(2);

    // Update variant price via Admin API
    const url = `https://${SHOP}/admin/api/2024-10/variants/${variantId}.json`;
    const apiRes = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': TOKEN
      },
      body: JSON.stringify({ variant: { id: variantId, price: newPrice } })
    });

    if (!apiRes.ok) {
      const text = await apiRes.text();
      console.error('[Shopify PUT failed]', apiRes.status, text);
      return res.status(502).json({ error: 'Shopify update failed', detail: text });
    }

    return res.json({
      variantId,
      price: Number(newPrice),
      length_m: Number(lengthM.toFixed(3))
    });
  } catch (err) {
    console.error('[Server error]', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.get('/', (_req, res) => res.send('Custom price API is running!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Custom price API listening on :${PORT}`));
