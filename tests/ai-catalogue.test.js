import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  MAX_CATALOGUE_ITEMS,
  computeSqftPerBox,
  extractCatalogueFromPdf,
  parseCatalogueJson,
  parseLooseNumber,
  sanitiseCataloguePayload,
  sanitiseExtractedProduct
} from '../src/ai-catalogue.js';
import {
  GEMINI_INLINE_MAX_BYTES,
  GEMINI_UPLOAD_CHUNK_BYTES,
  MAX_PDF_BYTES,
  OPENAI_MAX_PDF_BYTES
} from '../shared/constants.js';

const PDF = Buffer.from('%PDF-1.4\nfake catalogue\n%%EOF');

function geminiResponse(payload, { status = 200, finishReason = 'STOP' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () =>
      JSON.stringify(
        status >= 300
          ? { error: { message: payload } }
          : {
              candidates: [
                {
                  finishReason,
                  content: { parts: [{ text: typeof payload === 'string' ? payload : JSON.stringify(payload) }] }
                }
              ]
            }
      )
  };
}

test('parses prices written with Indian formatting', () => {
  assert.equal(parseLooseNumber('₹1,23,456.50'), 123456.5);
  assert.equal(parseLooseNumber('Rs. 62 / sq ft'), 62);
  assert.equal(parseLooseNumber('INR 15.5'), 15.5);
  assert.equal(parseLooseNumber(''), null);
  assert.equal(parseLooseNumber('call showroom'), null);
});

test('computes pack area from tile size and pieces', () => {
  assert.equal(computeSqftPerBox('600 × 600 mm', 4), 15.5);
  assert.equal(computeSqftPerBox('300x600 mm', 8), 15.5);
  assert.equal(computeSqftPerBox('60 × 60 cm', 4), 15.5);
  assert.equal(computeSqftPerBox('', 4), null);
});

test('sanitises one product without inventing missing fields', () => {
  const product = sanitiseExtractedProduct({
    name: '  Aspen   Grey Matt ',
    code: 'kaj-asp-6060',
    category: 'Vitrified floor tiles',
    size: '600x600 mm',
    gst: '18%',
    price: '₹62',
    pcsPerBox: '4',
    stock: '120 boxes',
    dealerPriceBox: '₹651'
  });

  assert.deepEqual(product, {
    name: 'Aspen Grey Matt',
    sku: 'KAJ-ASP-6060',
    category: 'Floor Tile',
    size: '600 × 600 mm',
    gstRate: 18,
    pcsPerBox: 4,
    sqftPerBox: 15.5,
    sellUnit: 'sqft',
    price: 62,
    costPerBox: 651,
    stockBoxes: 120
  });
});

test('deduplicates rows, merges missing fields and ignores nameless rows', () => {
  const payload = sanitiseCataloguePayload({
    supplier: 'Kajaria',
    products: [
      { name: 'Aspen Grey', sku: 'A1', price: 62 },
      { name: 'Aspen Grey Matt', sku: 'a1', pcsPerBox: 4, size: '600 × 600 mm' },
      { sku: 'NO-NAME', price: 40 },
      { name: 'Adhesive', category: 'Adhesive & Grout', price: 350, unit: 'box' }
    ]
  });

  assert.equal(payload.supplier, 'Kajaria');
  assert.equal(payload.products.length, 2);
  assert.equal(payload.products[0].name, 'Aspen Grey');
  assert.equal(payload.products[0].pcsPerBox, 4);
  assert.equal(payload.products[0].sqftPerBox, 15.5);
  assert.equal(payload.products[0].price, 62);
  assert.equal(payload.products[1].sellUnit, 'box');
  assert.match(payload.warnings.join(' '), /without a usable product name/);
});

test('caps very large catalogues', () => {
  const products = Array.from({ length: MAX_CATALOGUE_ITEMS + 3 }, (_, index) => ({
    name: `Tile ${index + 1}`,
    price: 50
  }));
  const payload = sanitiseCataloguePayload({ products });
  assert.equal(payload.products.length, MAX_CATALOGUE_ITEMS);
  assert.match(payload.warnings.join(' '), /Only the first/);
});

test('reads JSON wrapped in fences or surrounding prose', () => {
  assert.deepEqual(parseCatalogueJson('```json\n{"products":[]}\n```'), { products: [] });
  assert.deepEqual(parseCatalogueJson('Here you go:\n{"products":[{"name":"A"}]}\nDone.'), {
    products: [{ name: 'A' }]
  });
  assert.deepEqual(parseCatalogueJson('[{"name":"A"}]'), [{ name: 'A' }]);
  assert.throws(() => parseCatalogueJson('not json'), /could not be read as JSON/);
});

test('extracts through Gemini with an inline PDF', async () => {
  let request = null;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return geminiResponse({ supplier: 'Somany', products: [{ name: 'Carrara', price: 78, size: '600 × 1200 mm' }] });
  };

  const result = await extractCatalogueFromPdf({
    pdfBuffer: PDF,
    fileName: 'somany.pdf',
    apiKey: 'test-key',
    provider: 'gemini',
    model: 'gemini-test',
    fetchImpl
  });

  assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent?key=test-key');
  const body = JSON.parse(request.options.body);
  assert.equal(body.contents[0].parts[0].inline_data.mime_type, 'application/pdf');
  assert.equal(body.contents[0].parts[0].inline_data.data, PDF.toString('base64'));
  assert.match(body.contents[0].parts[1].text, /Extract every sellable product/);
  assert.equal(result.provider, 'gemini');
  assert.equal(result.model, 'gemini-test');
  assert.equal(result.supplier, 'Somany');
  assert.equal(result.products[0].name, 'Carrara');
});

test('uploads large PDFs through the Gemini File API', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sai-catalogue-'));
  const pdfPath = path.join(dir, 'large.pdf');
  const pdfSize = GEMINI_INLINE_MAX_BYTES + 4 * 1024 * 1024;
  const pdf = Buffer.alloc(pdfSize, 0x20);
  pdf.write('%PDF-1.7\n', 0, 'latin1');
  await writeFile(pdfPath, pdf);

  const uploadUrl = 'https://upload.example/session/1';
  const events = [];
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.startsWith('https://generativelanguage.googleapis.com/upload/v1beta/files?')) {
      return new Response(null, { status: 200, headers: { 'x-goog-upload-url': uploadUrl } });
    }
    if (url === uploadUrl) {
      const offset = Number(options.headers['X-Goog-Upload-Offset']);
      assert.equal(options.body.length, Math.min(GEMINI_UPLOAD_CHUNK_BYTES, pdfSize - offset));
      if (options.headers['X-Goog-Upload-Command'] === 'upload, finalize') {
        return new Response(
          JSON.stringify({
            file: { name: 'files/abc', uri: 'https://files.example/abc', state: 'ACTIVE' }
          }),
          { status: 200 }
        );
      }
      return new Response(null, { status: 308 });
    }
    if (url.includes(':generateContent')) {
      return geminiResponse({ products: [{ name: 'Large Tile', price: 70 }] });
    }
    if (options.method === 'DELETE') return new Response(null, { status: 200 });
    throw new Error(`Unexpected request ${options.method} ${url}`);
  };

  try {
    const result = await extractCatalogueFromPdf({
      pdfPath,
      fileName: 'large-list.pdf',
      apiKey: 'test-key',
      provider: 'gemini',
      model: 'gemini-test',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      fetchImpl,
      onProgress: (event) => events.push(event)
    });

    assert.equal(result.products[0].name, 'Large Tile');
    const start = calls.find((call) =>
      call.url.startsWith('https://generativelanguage.googleapis.com/upload/v1beta/files?')
    );
    assert.equal(start.options.headers['X-Goog-Upload-Protocol'], 'resumable');
    assert.equal(start.options.headers['X-Goog-Upload-Header-Content-Length'], String(pdfSize));

    const uploads = calls.filter((call) => call.url === uploadUrl);
    assert.equal(uploads.length, 3);
    assert.equal(uploads[2].options.headers['X-Goog-Upload-Command'], 'upload, finalize');
    assert.equal(uploads[2].options.headers['X-Goog-Upload-Offset'], String(GEMINI_UPLOAD_CHUNK_BYTES * 2));

    const generation = calls.find((call) => call.url.includes(':generateContent'));
    const body = JSON.parse(generation.options.body);
    assert.equal(body.contents[0].parts[0].file_data.file_uri, 'https://files.example/abc');
    assert.equal(body.contents[0].parts[0].inline_data, undefined);
    assert.ok(events.some((event) => event.stage === 'upload' && event.loaded === pdfSize));
    assert.ok(events.some((event) => event.stage === 'reading'));
    assert.ok(calls.some((call) => call.options.method === 'DELETE'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('enforces the 1 GB limit and OpenAI’s smaller PDF limit', async () => {
  assert.equal(MAX_PDF_BYTES, 1024 * 1024 * 1024);
  await assert.rejects(
    () =>
      extractCatalogueFromPdf({
        pdfBuffer: Buffer.allocUnsafe(OPENAI_MAX_PDF_BYTES + 1),
        apiKey: 'key',
        provider: 'openai',
        fetchImpl: async () => {
          throw new Error('should not be called');
        }
      }),
    /OpenAI accepts PDFs up to 32 MB/
  );
  await assert.rejects(
    () => extractCatalogueFromPdf({ pdfPath: path.join(os.tmpdir(), 'missing-catalogue.pdf'), apiKey: 'key' }),
    /could not be opened/
  );
});

test('extracts through OpenAI Responses with a file part', async () => {
  let request = null;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [
                { type: 'output_text', text: JSON.stringify({ products: [{ name: 'Fern', sku: 'F1', price: 99 }] }) }
              ]
            }
          ]
        })
    };
  };

  const result = await extractCatalogueFromPdf({
    pdfBuffer: PDF,
    fileName: 'catalogue.pdf',
    apiKey: 'sk-test',
    provider: 'openai',
    model: 'gpt-test',
    baseUrl: 'https://proxy.example/v1/',
    fetchImpl
  });

  assert.equal(request.url, 'https://proxy.example/v1/responses');
  assert.equal(request.options.headers.Authorization, 'Bearer sk-test');
  const body = JSON.parse(request.options.body);
  assert.equal(body.input[0].content[0].type, 'input_file');
  assert.equal(body.input[0].content[0].filename, 'catalogue.pdf');
  assert.equal(body.input[0].content[0].file_data, `data:application/pdf;base64,${PDF.toString('base64')}`);
  assert.equal(result.products[0].sku, 'F1');
});

test('reports rejected keys without leaking the request URL', async () => {
  const fetchImpl = async () =>
    geminiResponse('API key not valid. Please pass a valid API key.', { status: 400 });

  await assert.rejects(
    () =>
      extractCatalogueFromPdf({
        pdfBuffer: PDF,
        apiKey: 'super-secret-key',
        provider: 'gemini',
        fetchImpl
      }),
    (error) => {
      assert.match(error.message, /refused the request/);
      assert.doesNotMatch(error.message, /super-secret-key/);
      return true;
    }
  );

  const unauthorized = async () => geminiResponse('nope', { status: 401 });
  await assert.rejects(
    () => extractCatalogueFromPdf({ pdfBuffer: PDF, apiKey: 'secret', fetchImpl: unauthorized }),
    /AI key was rejected/
  );
});

test('requires a key and a PDF', async () => {
  await assert.rejects(() => extractCatalogueFromPdf({ pdfBuffer: PDF, apiKey: '' }), /API key/);
  await assert.rejects(() => extractCatalogueFromPdf({ pdfBuffer: null, apiKey: 'key' }), /Choose a PDF/);
});

test('explains network failures', async () => {
  const fetchImpl = async () => {
    throw new TypeError('fetch failed');
  };
  await assert.rejects(
    () => extractCatalogueFromPdf({ pdfBuffer: PDF, apiKey: 'key', fetchImpl }),
    /Could not reach the AI provider/
  );
});
