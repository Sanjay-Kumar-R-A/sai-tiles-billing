import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DEFAULT_SETTINGS = {
  showroomName: 'SAI TILES',
  legalName: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: 'Tamil Nadu',
  stateCode: '33',
  pincode: '',
  phone: '',
  email: '',
  gstin: '',
  pan: '',
  jurisdiction: '',
  bankName: '',
  accountName: '',
  accountNumber: '',
  ifsc: '',
  upiId: '',
  invoicePrefix: 'INV',
  defaultGstRate: 18,
  roundOffEnabled: true,
  dueDays: 15,
  terms:
    '1. Goods once sold will not be taken back or exchanged.\n2. Please inspect tiles for shade, size and quality before installation.\n3. Claims for breakage or shortage must be made at the time of delivery.\n4. Payment by cheque is subject to realisation.',
  footerNote: 'Thank you for choosing SAI TILES.',
  profileReviewed: false,
  aiProvider: 'gemini',
  aiModel: 'gemini-2.5-flash',
  aiBaseUrl: ''
};

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA synchronous = FULL;

  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sequences (
    name TEXT PRIMARY KEY,
    next_value INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    brand TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'Floor Tile',
    size TEXT NOT NULL DEFAULT '',
    finish TEXT NOT NULL DEFAULT '',
    hsn TEXT NOT NULL DEFAULT '6907',
    gst_rate REAL NOT NULL DEFAULT 18,
    sell_unit TEXT NOT NULL DEFAULT 'sqft' CHECK (sell_unit IN ('sqft', 'box')),
    price REAL NOT NULL DEFAULT 0,
    cost_per_box REAL NOT NULL DEFAULT 0,
    sqft_per_box REAL NOT NULL DEFAULT 0,
    pcs_per_box INTEGER NOT NULL DEFAULT 0,
    stock_boxes REAL NOT NULL DEFAULT 0,
    reorder_level REAL NOT NULL DEFAULT 0,
    batch_no TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    gstin TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'Retail',
    address TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'Tamil Nadu',
    pincode TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_no TEXT NOT NULL UNIQUE COLLATE NOCASE,
    invoice_date TEXT NOT NULL,
    due_date TEXT,
    customer_id INTEGER REFERENCES customers(id),
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL DEFAULT '',
    customer_gstin TEXT NOT NULL DEFAULT '',
    billing_address TEXT NOT NULL DEFAULT '',
    shipping_address TEXT NOT NULL DEFAULT '',
    customer_state TEXT NOT NULL DEFAULT '',
    place_of_supply TEXT NOT NULL,
    state_code TEXT NOT NULL DEFAULT '',
    subtotal REAL NOT NULL DEFAULT 0,
    discount_total REAL NOT NULL DEFAULT 0,
    taxable_total REAL NOT NULL DEFAULT 0,
    cgst REAL NOT NULL DEFAULT 0,
    sgst REAL NOT NULL DEFAULT 0,
    igst REAL NOT NULL DEFAULT 0,
    round_off REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    amount_paid REAL NOT NULL DEFAULT 0,
    balance REAL NOT NULL DEFAULT 0,
    payment_status TEXT NOT NULL DEFAULT 'unpaid',
    status TEXT NOT NULL DEFAULT 'active',
    notes TEXT NOT NULL DEFAULT '',
    terms TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    voided_at TEXT,
    void_reason TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    name TEXT NOT NULL,
    sku TEXT NOT NULL DEFAULT '',
    hsn TEXT NOT NULL DEFAULT '',
    qty REAL NOT NULL,
    unit TEXT NOT NULL CHECK (unit IN ('sqft', 'box')),
    sqft_per_box REAL NOT NULL DEFAULT 0,
    rate REAL NOT NULL,
    discount_pct REAL NOT NULL DEFAULT 0,
    gross REAL NOT NULL DEFAULT 0,
    discount REAL NOT NULL DEFAULT 0,
    taxable REAL NOT NULL DEFAULT 0,
    gst_rate REAL NOT NULL DEFAULT 0,
    cgst REAL NOT NULL DEFAULT 0,
    sgst REAL NOT NULL DEFAULT 0,
    igst REAL NOT NULL DEFAULT 0,
    line_total REAL NOT NULL DEFAULT 0,
    stock_boxes REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    payment_date TEXT NOT NULL,
    amount REAL NOT NULL,
    method TEXT NOT NULL DEFAULT 'Cash',
    reference TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    movement_date TEXT NOT NULL,
    type TEXT NOT NULL,
    qty_boxes REAL NOT NULL,
    unit_cost REAL NOT NULL DEFAULT 0,
    reference TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    invoice_id INTEGER REFERENCES invoices(id),
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);
  CREATE INDEX IF NOT EXISTS idx_customers_active ON customers(active);
  CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(invoice_date);
  CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status, payment_status);
  CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
  CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
  CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
  CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);
  CREATE INDEX IF NOT EXISTS idx_movements_product ON stock_movements(product_id, movement_date);

  PRAGMA user_version = 1;
`;

const SEED_PRODUCTS = [
  {
    sku: 'KAJ-ASP-6060',
    name: 'Aspen Grey Matt',
    brand: 'Kajaria',
    category: 'Floor Tile',
    size: '600 × 600 mm',
    finish: 'Matt',
    hsn: '6907',
    gstRate: 18,
    sellUnit: 'sqft',
    price: 62,
    costPerBox: 651,
    sqftPerBox: 15.5,
    pcsPerBox: 4,
    stockBoxes: 120,
    reorderLevel: 20,
    batchNo: 'KJ-A-2418'
  },
  {
    sku: 'SOM-CAR-6012',
    name: 'Carrara Statuario Gloss',
    brand: 'Somany',
    category: 'Floor Tile',
    size: '600 × 1200 mm',
    finish: 'Glossy',
    hsn: '6907',
    gstRate: 18,
    sellUnit: 'sqft',
    price: 78,
    costPerBox: 852,
    sqftPerBox: 15.5,
    pcsPerBox: 2,
    stockBoxes: 64,
    reorderLevel: 12,
    batchNo: 'SM-C-3121'
  },
  {
    sku: 'JOH-TER-2012',
    name: 'Terra Oak Plank',
    brand: 'Johnson',
    category: 'Floor Tile',
    size: '200 × 1200 mm',
    finish: 'Wood Matt',
    hsn: '6907',
    gstRate: 18,
    sellUnit: 'sqft',
    price: 55,
    costPerBox: 490,
    sqftPerBox: 12.9,
    pcsPerBox: 5,
    stockBoxes: 88,
    reorderLevel: 15,
    batchNo: 'JH-T-1740'
  },
  {
    sku: 'VAR-OCN-3060',
    name: 'Ocean Blue Wall',
    brand: 'Varmora',
    category: 'Wall Tile',
    size: '300 × 600 mm',
    finish: 'Glossy',
    hsn: '6907',
    gstRate: 18,
    sellUnit: 'sqft',
    price: 42,
    costPerBox: 434,
    sqftPerBox: 15.5,
    pcsPerBox: 8,
    stockBoxes: 150,
    reorderLevel: 24,
    batchNo: 'VR-O-2084'
  },
  {
    sku: 'SIM-STA-8016',
    name: 'Statuario Grande Polished',
    brand: 'Simpolo',
    category: 'Floor Tile',
    size: '800 × 1600 mm',
    finish: 'Polished',
    hsn: '6907',
    gstRate: 18,
    sellUnit: 'sqft',
    price: 112,
    costPerBox: 2255,
    sqftPerBox: 27.5,
    pcsPerBox: 2,
    stockBoxes: 34,
    reorderLevel: 10,
    batchNo: 'SP-S-1192'
  },
  {
    sku: 'KAJ-MAR-6060',
    name: 'Marble Crest Ivory',
    brand: 'Kajaria',
    category: 'Floor Tile',
    size: '600 × 600 mm',
    finish: 'Matt',
    hsn: '6907',
    gstRate: 18,
    sellUnit: 'sqft',
    price: 68,
    costPerBox: 744,
    sqftPerBox: 15.5,
    pcsPerBox: 4,
    stockBoxes: 8,
    reorderLevel: 16,
    batchNo: 'KJ-M-2666'
  },
  {
    sku: 'SOM-END-6060',
    name: 'Endless Wood Beige',
    brand: 'Somany',
    category: 'Floor Tile',
    size: '600 × 600 mm',
    finish: 'Carving Matt',
    hsn: '6907',
    gstRate: 18,
    sellUnit: 'sqft',
    price: 72,
    costPerBox: 806,
    sqftPerBox: 15.5,
    pcsPerBox: 4,
    stockBoxes: 4,
    reorderLevel: 12,
    batchNo: 'SM-E-3088'
  },
  {
    sku: 'ORI-TER-3030',
    name: 'Terrazzo Chips Grey',
    brand: 'Orientbell',
    category: 'Outdoor',
    size: '300 × 300 mm',
    finish: 'Anti-skid',
    hsn: '6907',
    gstRate: 18,
    sellUnit: 'sqft',
    price: 48,
    costPerBox: 344,
    sqftPerBox: 10.76,
    pcsPerBox: 9,
    stockBoxes: 72,
    reorderLevel: 12,
    batchNo: 'OB-T-5520'
  }
];

const SEED_CUSTOMERS = [
  {
    name: 'Karthik Raman',
    phone: '98400 22110',
    email: '',
    gstin: '',
    type: 'Contractor',
    address: '14, Lake View Colony, Adambakkam',
    city: 'Chennai',
    state: 'Tamil Nadu',
    pincode: '600088',
    notes: 'Sample customer — replace with your customer.'
  },
  {
    name: 'Vishwa Interiors',
    phone: '98410 44781',
    email: 'accounts@vishwainteriors.example',
    gstin: '33ABCDE1234F1Z5',
    type: 'Interior Designer',
    address: 'No. 8, Anna Salai, Teynampet',
    city: 'Chennai',
    state: 'Tamil Nadu',
    pincode: '600018',
    notes: 'Sample customer — replace with your customer.'
  },
  {
    name: 'Apex Builders & Developers',
    phone: '99620 31862',
    email: '',
    gstin: '',
    type: 'Builder',
    address: 'Trichy Road, Ramanathapuram',
    city: 'Coimbatore',
    state: 'Tamil Nadu',
    pincode: '641045',
    notes: 'Sample customer — replace with your customer.'
  }
];

export function openDatabase(dbPath, { seed = true } = {}) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);

  const settingsRow = db.prepare("SELECT value FROM meta WHERE key = 'settings'").get();
  if (!settingsRow) {
    db.prepare("INSERT INTO meta (key, value) VALUES ('settings', ?)").run(JSON.stringify(DEFAULT_SETTINGS));
  }

  db.prepare("INSERT OR IGNORE INTO sequences (name, next_value) VALUES ('invoice', 1)").run();

  if (seed) {
    const seededRow = db.prepare("SELECT value FROM meta WHERE key = 'sample_data_seeded'").get();
    if (!seededRow) {
      seedSampleData(db);
      db.prepare("INSERT INTO meta (key, value) VALUES ('sample_data_seeded', ?)").run(new Date().toISOString());
    }
  }

  return db;
}

function seedSampleData(db) {
  const now = new Date().toISOString();
  const today = new Date();
  const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const insertProduct = db.prepare(`
    INSERT INTO products (
      sku, name, brand, category, size, finish, hsn, gst_rate, sell_unit, price,
      cost_per_box, sqft_per_box, pcs_per_box, stock_boxes, reorder_level, batch_no,
      notes, active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 1, ?, ?)
  `);
  const insertMovement = db.prepare(`
    INSERT INTO stock_movements (
      product_id, movement_date, type, qty_boxes, unit_cost, reference, notes, invoice_id, created_at
    ) VALUES (?, ?, 'opening', ?, ?, 'Starter catalogue', 'Opening stock', NULL, ?)
  `);

  for (const product of SEED_PRODUCTS) {
    const result = insertProduct.run(
      product.sku,
      product.name,
      product.brand,
      product.category,
      product.size,
      product.finish,
      product.hsn,
      product.gstRate,
      product.sellUnit,
      product.price,
      product.costPerBox,
      product.sqftPerBox,
      product.pcsPerBox,
      product.stockBoxes,
      product.reorderLevel,
      product.batchNo,
      now,
      now
    );
    insertMovement.run(Number(result.lastInsertRowid), todayString, product.stockBoxes, product.costPerBox, now);
  }

  const insertCustomer = db.prepare(`
    INSERT INTO customers (
      name, phone, email, gstin, type, address, city, state, pincode, notes, active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);

  for (const customer of SEED_CUSTOMERS) {
    insertCustomer.run(
      customer.name,
      customer.phone,
      customer.email,
      customer.gstin,
      customer.type,
      customer.address,
      customer.city,
      customer.state,
      customer.pincode,
      customer.notes,
      now,
      now
    );
  }
}
