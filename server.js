import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const SHOP = process.env.SHOPIFY_SHOP;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const VARIANT_ID = '42383692988550';

// --- Price logic ---
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

  return { ok: true, price: Number(price.toFixed(2)) };
}

// --- CORS ---
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  const allowed = [
    /\.myshopify\.com$/i,
    /circusconcepts\.com$/i,
    /\.shopifypreview\.com$/i
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

// --- POST /api/custom-price ---
app.post('/api/custom-price', async (req, res) => {
  try {
    const { length_m, feet, inches } = req.body || {};
    let lengthM = Number(length_m);

    if ((!lengthM || isNaN(lengthM)) && (feet != null || inches != null)) {
      const f = Number(feet) || 0;
      const i = Number(inches) || 0;
      lengthM = f * 0.3048 + i * 0.0254;
    }

    const result = computePrice(lengthM);
    if (!result.ok) return res.status(400).json({ error: result.error });

    const newPrice = result.price.toFixed(2);

    // --- Update variant price in Shopify ---
    const url = `https://${SHOP}/admin/api/2025-01/variants/${VARIANT_ID}.json`;
    const apiRes = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': TOKEN
      },
      body: JSON.stringify({ variant: { id: Number(VARIANT_ID), price: newPrice } })
    });

    if (!apiRes.ok) {
      const text = await apiRes.text();
      console.error('[Shopify PUT failed]', apiRes.status, text);
      return res.status(502).json({ error: 'Shopify update failed', detail: text });
    }

    return res.json({
      variantId: Number(VARIANT_ID),
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
