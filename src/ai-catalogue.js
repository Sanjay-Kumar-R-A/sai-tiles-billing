import { GST_RATES } from '../shared/calc.js';
import { PRODUCT_CATEGORIES } from '../shared/constants.js';

export const MAX_CATALOGUE_ITEMS = 300;
export const MAX_PDF_BYTES = 25 * 1024 * 1024;

export const PROVIDER_DEFAULTS = {
  gemini: {
    label: 'Google Gemini',
    model: 'gemini-2.5-flash',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta'
  },
  openai: {
    label: 'OpenAI',
    model: 'gpt-4.1-mini',
    baseUrl: 'https://api.openai.com/v1'
  }
};

const CATEGORY_HINTS = [
  { category: 'Adhesive & Grout', pattern: /adhesive|grout|glue|bonding|cement|epoxy/i },
  { category: 'Bathroom', pattern: /bathroom|washroom|sanitary|basin|toilet/i },
  { category: 'Outdoor', pattern: /outdoor|parking|elevation|facade|garden|terrace|anti[- ]?skid/i },
  { category: 'Wall Tile', pattern: /wall|wall tile|kitchen/i },
  { category: 'Floor Tile', pattern: /floor|vitrified|ceramic|porcelain|marble|granite|tile/i }
];

const PROMPT = `You are reading a tiles and building-materials catalogue or price list from an Indian showroom.
Extract every sellable product with its catalogue details and return JSON only.

Return this exact shape:
{
  "supplier": "brand or supplier name shown on the catalogue, or empty string",
  "products": [
    {
      "name": "model or product name",
      "sku": "item code or design number, or empty string",
      "brand": "brand, or empty string",
      "category": "one of: Floor Tile, Wall Tile, Outdoor, Bathroom, Adhesive & Grout, Other",
      "size": "tile size exactly as shown, e.g. 600 × 600 mm, or empty string",
      "finish": "finish, e.g. Matt, Glossy, Rustic, or empty string",
      "hsn": "HSN code if shown, else 6907 for tiles and 3214 for adhesives or grout",
      "gstRate": 18,
      "sellUnit": "sqft or box",
      "price": 62,
      "costPerBox": 0,
      "sqftPerBox": 15.5,
      "pcsPerBox": 4,
      "stockBoxes": 0,
      "reorderLevel": 0,
      "batchNo": "",
      "notes": ""
    }
  ]
}

Rules:
1. Use only information visible in the PDF. Never invent names, prices, stock, sizes or codes.
2. Prices are Indian rupees. Ignore MRP if a separate dealer/offer price is shown; use the regular selling price actually quoted to customers.
3. price is the selling rate for sellUnit. If the price is per box, set sellUnit to "box". If per square foot, set it to "sqft".
4. If the catalogue gives a box price and a pack area, keep sellUnit "box" and set price to the box price. If it gives only a per-sq-ft price, use "sqft".
5. sqftPerBox: use a stated value. Otherwise compute from the tile size and pieces per box: (width_mm × height_mm × pcsPerBox) ÷ 92903.04, rounded to 2 decimals. For 600 × 600 mm with 4 pieces this is 15.5. If it cannot be computed, use 0.
6. pcsPerBox: pieces per box only when stated or clearly implied by the size and coverage.
7. stockBoxes: only when the PDF explicitly shows available stock, quantity or boxes on hand, and only in boxes. Otherwise 0. Never guess stock.
8. gstRate must be one of 0, 5, 12, 18, 28. Use the listed rate, else 18.
9. costPerBox: only when the PDF shows a dealer, purchase or cost price per box. Otherwise 0.
10. category must be exactly one of the listed values. Tiles are Floor Tile unless the catalogue clearly labels them as wall, outdoor or bathroom tiles.
11. Skip cover pages, indexes, image-only pages without product data and installation instructions. Keep one row per distinct product code. If the same product appears more than once, merge it.
12. name is required. Do not return a row without a product name.
13. Return at most ${MAX_CATALOGUE_ITEMS} products. If the catalogue is longer, extract the first ${MAX_CATALOGUE_ITEMS} distinct products.
14. Return JSON only, with no markdown fences and no commentary.`;

function cleanText(value, maxLength = 200) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function cleanNote(value, maxLength = 300) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function parseLooseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value == null) return null;
  const text = String(value)
    .replace(/[₹$]/g, '')
    .replace(/\b(?:inr|rs\.?|rupees)\b/gi, '')
    .replace(/,/g, '')
    .trim();
  if (!text) return null;
  const match = /-?\d+(?:\.\d+)?/.exec(text);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function normaliseSize(value) {
  const text = cleanText(value, 40);
  if (!text) return '';
  return text
    .replace(/(\d)\s*[xX×*]\s*(\d)/g, '$1 × $2')
    .replace(/\s+/g, ' ');
}

export function computeSqftPerBox(size, pcsPerBox) {
  const pieces = parseLooseNumber(pcsPerBox);
  if (!pieces || pieces <= 0) return null;
  const text = String(size ?? '');
  const match = /(\d+(?:\.\d+)?)\s*(cm|mm)?\s*[×xX*]\s*(\d+(?:\.\d+)?)\s*(cm|mm)?/i.exec(text);
  if (!match) return null;
  let width = Number(match[1]);
  let height = Number(match[3]);
  const unit = (match[2] || match[4] || 'mm').toLowerCase();
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (unit === 'cm') {
    width *= 10;
    height *= 10;
  }
  if (width < 30 || height < 30 || width > 4000 || height > 4000) return null;
  const area = (width * height * pieces) / 92903.04;
  if (!Number.isFinite(area) || area <= 0 || area > 2000) return null;
  return Math.round(area * 100) / 100;
}

function normaliseCategory(value) {
  const text = cleanText(value, 60);
  if (!text) return 'Floor Tile';
  const exact = PRODUCT_CATEGORIES.find((category) => category.toLowerCase() === text.toLowerCase());
  if (exact) return exact;
  const hinted = CATEGORY_HINTS.find((entry) => entry.pattern.test(text));
  return hinted?.category ?? 'Other';
}

function snapGstRate(value) {
  const number = parseLooseNumber(value);
  if (number == null) return null;
  const match = GST_RATES.find((rate) => Math.abs(rate - number) < 0.6);
  return match ?? null;
}

function soldByBox(raw) {
  const unit = cleanText(raw.sellUnit ?? raw.priceUnit ?? raw.unit, 30).toLowerCase();
  if (!unit) return null;
  if (/\bbox(es)?\b|\bper box\b/.test(unit)) return 'box';
  if (/\bsq\.?\s*ft\b|\bsquare\s*feet\b|\bsqft\b/.test(unit)) return 'sqft';
  return null;
}

function positive(value) {
  const number = parseLooseNumber(value);
  return number != null && number > 0 ? number : null;
}

export function sanitiseExtractedProduct(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const name = cleanText(raw.name ?? raw.title ?? raw.productName ?? raw.product, 120);
  if (!name) return null;

  const product = { name };
  const sku = cleanText(raw.sku ?? raw.code ?? raw.itemCode ?? raw.design, 40).toUpperCase();
  if (sku) product.sku = sku;
  const brand = cleanText(raw.brand ?? raw.supplier ?? raw.company, 60);
  if (brand) product.brand = brand;
  product.category = normaliseCategory(raw.category ?? raw.type);
  const size = normaliseSize(raw.size ?? raw.dimensions);
  if (size) product.size = size;
  const finish = cleanText(raw.finish ?? raw.surface, 40);
  if (finish) product.finish = finish;
  const hsn = cleanText(raw.hsn ?? raw.hsnCode, 20);
  if (hsn) product.hsn = hsn;
  const gstRate = snapGstRate(raw.gstRate ?? raw.gst ?? raw.taxRate);
  if (gstRate != null) product.gstRate = gstRate;

  const pcsPerBox = positive(raw.pcsPerBox ?? raw.piecesPerBox ?? raw.pcs);
  if (pcsPerBox) product.pcsPerBox = Math.max(1, Math.round(pcsPerBox));
  let sqftPerBox = positive(raw.sqftPerBox ?? raw.areaPerBox ?? raw.coverage ?? raw.sqft);
  if (!sqftPerBox && product.pcsPerBox) {
    sqftPerBox = computeSqftPerBox(size, product.pcsPerBox);
  }
  if (sqftPerBox) product.sqftPerBox = Math.round(sqftPerBox * 100) / 100;

  const price = parseLooseNumber(raw.price ?? raw.sellingPrice ?? raw.rate ?? raw.salePrice);
  if (price != null && price >= 0) {
    const unit = soldByBox(raw);
    product.sellUnit = unit ?? (product.sqftPerBox > 0 ? 'sqft' : 'box');
    product.price = Math.round(price * 100) / 100;
  }

  let costPerBox = positive(raw.costPerBox ?? raw.dealerPriceBox ?? raw.purchasePriceBox);
  if (!costPerBox) {
    const costPerSqft = positive(raw.costPerSqft ?? raw.dealerPriceSqft);
    if (costPerSqft && product.sqftPerBox > 0) {
      costPerBox = Math.round(costPerSqft * product.sqftPerBox * 100) / 100;
    }
  }
  if (costPerBox) product.costPerBox = Math.round(costPerBox * 100) / 100;

  const stock = parseLooseNumber(raw.stockBoxes ?? raw.stock ?? raw.quantity ?? raw.qty ?? raw.available);
  if (stock != null && stock > 0) product.stockBoxes = Math.round(stock * 1000) / 1000;

  const reorder = parseLooseNumber(raw.reorderLevel ?? raw.reorder);
  if (reorder != null && reorder > 0) product.reorderLevel = Math.round(reorder * 1000) / 1000;

  const batchNo = cleanText(raw.batchNo ?? raw.batch ?? raw.shade, 40);
  if (batchNo) product.batchNo = batchNo;
  const notes = cleanNote(raw.notes ?? raw.note);
  if (notes) product.notes = notes;

  return product;
}

function mergeMissing(base, extra) {
  for (const [key, value] of Object.entries(extra)) {
    if (base[key] === undefined || base[key] === '' || base[key] === 0) {
      base[key] = value;
    }
  }
  return base;
}

function productDedupeKey(product) {
  if (product.sku) return `sku:${product.sku.toLowerCase()}`;
  return `name:${[product.name, product.brand ?? '', product.size ?? '']
    .map((value) => cleanText(value, 120).toLowerCase())
    .join('|')}`;
}

export function sanitiseCataloguePayload(payload) {
  const source = Array.isArray(payload)
    ? { products: payload }
    : payload && typeof payload === 'object'
      ? payload
      : null;
  if (!source) throw new Error('The AI reply did not contain a catalogue.');

  const rows = source.products ?? source.items ?? source.catalogue ?? source.data;
  if (!Array.isArray(rows)) {
    throw new Error('The AI reply did not contain a product list. Try another PDF.');
  }

  const warnings = [];
  const products = [];
  const seen = new Map();
  let ignored = 0;

  for (const row of rows) {
    if (products.length >= MAX_CATALOGUE_ITEMS) {
      warnings.push(`Only the first ${MAX_CATALOGUE_ITEMS} products were kept. Split a larger catalogue into parts.`);
      break;
    }
    const product = sanitiseExtractedProduct(row);
    if (!product) {
      ignored += 1;
      continue;
    }
    const key = productDedupeKey(product);
    if (seen.has(key)) {
      mergeMissing(seen.get(key), product);
      continue;
    }
    seen.set(key, product);
    products.push(product);
  }

  if (ignored > 0) {
    warnings.push(`${ignored} row${ignored === 1 ? '' : 's'} without a usable product name were ignored.`);
  }
  if (!products.length) {
    throw new Error('No products could be read from this PDF. Try a clearer catalogue or price list.');
  }

  return {
    supplier: cleanText(source.supplier ?? source.brand ?? source.vendor, 120),
    products,
    warnings
  };
}

export function parseCatalogueJson(text) {
  const raw = String(text ?? '')
    .replace(/^\uFEFF/, '')
    .trim();
  if (!raw) throw new Error('The AI returned an empty reply. Try again.');

  const withoutFence = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  const candidates = [withoutFence];
  const objectStart = withoutFence.indexOf('{');
  const objectEnd = withoutFence.lastIndexOf('}');
  if (objectStart !== -1 && objectEnd > objectStart) {
    candidates.push(withoutFence.slice(objectStart, objectEnd + 1));
  }
  const arrayStart = withoutFence.indexOf('[');
  const arrayEnd = withoutFence.lastIndexOf(']');
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    candidates.push(withoutFence.slice(arrayStart, arrayEnd + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // Try the next candidate slice.
    }
  }
  throw new Error('The AI reply could not be read as JSON. Try again or use a clearer PDF.');
}

function providerErrorMessage(status, data) {
  if (status === 401 || status === 403) {
    return 'The AI key was rejected. Check it in Settings → AI catalogue.';
  }
  if (status === 404) {
    return 'The AI model was not found. Check the model name in Settings → AI catalogue.';
  }
  if (status === 413) {
    return 'This PDF is too large for the AI provider. Try a smaller catalogue.';
  }
  if (status === 429) {
    return 'The AI provider is busy or the quota is exhausted. Wait a minute and try again.';
  }
  const detail = cleanText(data?.error?.message, 220);
  if (detail) return `The AI provider refused the request: ${detail}`;
  if (status >= 500) return 'The AI provider had a server problem. Try again in a few minutes.';
  return 'The AI provider could not process this PDF. Try again.';
}

async function postJson(fetchImpl, url, options) {
  try {
    return await fetchImpl(url, {
      ...options,
      signal: AbortSignal.timeout(180000)
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new Error('The AI provider took too long to reply. Try a smaller PDF or try again.');
    }
    throw new Error('Could not reach the AI provider. Check the internet connection and base URL in Settings.');
  }
}

async function callGemini({ apiKey, model, baseUrl, pdfBase64, fetchImpl }) {
  const base = (baseUrl || PROVIDER_DEFAULTS.gemini.baseUrl).replace(/\/+$/, '');
  const response = await postJson(
    fetchImpl,
    `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { inline_data: { mime_type: 'application/pdf', data: pdfBase64 } },
              { text: PROMPT }
            ]
          }
        ],
        generationConfig: {
          temperature: 0,
          response_mime_type: 'application/json',
          maxOutputTokens: 65536
        }
      })
    }
  );

  const body = await response.text();
  let data = null;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    data = null;
  }
  if (!response.ok) throw new Error(providerErrorMessage(response.status, data));

  const candidate = data?.candidates?.[0];
  if (candidate?.finishReason === 'MAX_TOKENS') {
    throw new Error('The AI reply was cut off because the catalogue is large. Import a few pages at a time.');
  }
  if (candidate?.finishReason === 'SAFETY') {
    throw new Error('The AI provider blocked this PDF. Try another file.');
  }
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  const text = parts
    .filter((part) => typeof part?.text === 'string' && !part.thought)
    .map((part) => part.text)
    .join('');
  if (!text.trim()) {
    const blocked = data?.promptFeedback?.blockReason;
    if (blocked) throw new Error('The AI provider blocked this PDF. Try another file.');
    throw new Error('The AI returned an empty reply. Try again.');
  }
  return text;
}

async function callOpenAI({ apiKey, model, baseUrl, fileName, pdfBase64, fetchImpl }) {
  const base = (baseUrl || PROVIDER_DEFAULTS.openai.baseUrl).replace(/\/+$/, '');
  const response = await postJson(fetchImpl, `${base}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      instructions: 'You extract product data from PDF catalogues. Reply with JSON only.',
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_file',
              filename: fileName || 'catalogue.pdf',
              file_data: `data:application/pdf;base64,${pdfBase64}`
            },
            { type: 'input_text', text: PROMPT }
          ]
        }
      ],
      text: { format: { type: 'json_object' } },
      max_output_tokens: 32000
    })
  });

  const body = await response.text();
  let data = null;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    data = null;
  }
  if (!response.ok) throw new Error(providerErrorMessage(response.status, data));

  if (data?.status === 'incomplete') {
    const reason = data?.incomplete_details?.reason;
    if (reason === 'max_output_tokens') {
      throw new Error('The AI reply was cut off because the catalogue is large. Import a few pages at a time.');
    }
  }
  let text = typeof data?.output_text === 'string' ? data.output_text : '';
  if (!text) {
    const output = Array.isArray(data?.output) ? data.output : [];
    text = output
      .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
      .filter((content) => content?.type === 'output_text' && typeof content.text === 'string')
      .map((content) => content.text)
      .join('');
  }
  if (!text.trim()) throw new Error('The AI returned an empty reply. Try again.');
  return text;
}

export async function extractCatalogueFromPdf({
  pdfBuffer,
  fileName = 'catalogue.pdf',
  apiKey,
  provider = 'gemini',
  model,
  baseUrl = '',
  fetchImpl = globalThis.fetch
} = {}) {
  if (!Buffer.isBuffer(pdfBuffer) || !pdfBuffer.length) {
    throw new Error('Choose a PDF catalogue first.');
  }
  if (pdfBuffer.length > MAX_PDF_BYTES) {
    throw new Error('This PDF is larger than 25 MB. Try a smaller catalogue.');
  }
  const key = cleanText(apiKey, 400);
  if (!key) throw new Error('Add the AI API key in Settings → AI catalogue first.');
  const selectedProvider = provider === 'openai' ? 'openai' : provider === 'gemini' ? 'gemini' : null;
  if (!selectedProvider) throw new Error('Choose Google Gemini or OpenAI in Settings → AI catalogue.');
  const selectedModel = cleanText(model, 80) || PROVIDER_DEFAULTS[selectedProvider].model;
  if (typeof fetchImpl !== 'function') throw new Error('This Mac cannot reach the AI provider.');

  const pdfBase64 = pdfBuffer.toString('base64');
  const common = {
    apiKey: key,
    model: selectedModel,
    baseUrl: cleanText(baseUrl, 300),
    fileName: cleanText(fileName, 160),
    pdfBase64,
    fetchImpl
  };
  const text =
    selectedProvider === 'gemini'
      ? await callGemini(common)
      : await callOpenAI(common);

  const payload = parseCatalogueJson(text);
  const result = sanitiseCataloguePayload(payload);
  return {
    ...result,
    provider: selectedProvider,
    model: selectedModel
  };
}
