import {
  GST_RATES,
  PAYMENT_METHODS,
  computeInvoice,
  round2,
  round3,
  toNumber
} from '../shared/calc.js';
import { INDIAN_STATES } from '../shared/states.js';
import {
  addDaysISO,
  chunkDateSeries,
  daysBetween,
  localISO,
  todayISO
} from '../shared/format.js';
import { DEFAULT_SETTINGS } from './db.js';
import { CUSTOMER_TYPES, PRODUCT_CATEGORIES } from '../shared/constants.js';

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function nowIso() {
  return new Date().toISOString();
}

function cleanText(value, maxLength = 200) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function cleanMultiline(value, maxLength = 4000) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, maxLength);
}

function requireText(value, label, maxLength = 200) {
  const cleaned = cleanText(value, maxLength);
  if (!cleaned) throw new Error(`${label} is required.`);
  return cleaned;
}

function validNumber(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a number.`);
  if (number < min) throw new Error(`${label} cannot be less than ${min}.`);
  if (number > max) throw new Error(`${label} cannot be more than ${max}.`);
  return number;
}

function assertDate(value, label) {
  const raw = String(value ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error(`${label} is not a valid date.`);
  const [year, month, day] = raw.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error(`${label} is not a valid date.`);
  }
  return raw;
}

function normaliseState(value) {
  const raw = cleanText(value, 80);
  const state = INDIAN_STATES.find(
    (entry) => entry.name.toLowerCase() === raw.toLowerCase() || entry.code === raw
  );
  if (!state) throw new Error('Choose a valid Indian state for the place of supply.');
  return state;
}

function normaliseGstin(value) {
  const gstin = cleanText(value, 15).toUpperCase();
  if (!gstin) return '';
  if (!GSTIN_PATTERN.test(gstin)) throw new Error('GSTIN must be a valid 15-character GST number.');
  return gstin;
}

function derivePaymentStatus(total, paid) {
  const balance = round2(Math.max(total - paid, 0));
  if (balance <= 0.004) return { balance: 0, paymentStatus: 'paid' };
  return { balance, paymentStatus: paid > 0.004 ? 'partial' : 'unpaid' };
}

function paymentStatusFor(total, paid) {
  return derivePaymentStatus(total, paid).paymentStatus;
}

function withTransaction(db, callback) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore rollback failures so the original error surfaces.
    }
    throw error;
  }
}

function productRates(product) {
  const sqftPerBox = toNumber(product.sqftPerBox);
  const price = toNumber(product.price);
  const pricePerSqft =
    product.sellUnit === 'sqft' ? round2(price) : sqftPerBox > 0 ? round2(price / sqftPerBox) : null;
  const pricePerBox =
    product.sellUnit === 'box' ? round2(price) : sqftPerBox > 0 ? round2(price * sqftPerBox) : null;
  return { pricePerSqft, pricePerBox };
}

function mapProduct(row) {
  const base = {
    id: Number(row.id),
    sku: row.sku ?? '',
    name: row.name,
    brand: row.brand ?? '',
    category: row.category ?? '',
    size: row.size ?? '',
    finish: row.finish ?? '',
    hsn: row.hsn ?? '',
    gstRate: round2(row.gst_rate),
    sellUnit: row.sell_unit,
    price: round2(row.price),
    costPerBox: round2(row.cost_per_box),
    sqftPerBox: round2(row.sqft_per_box),
    pcsPerBox: Number(row.pcs_per_box ?? 0),
    stockBoxes: round3(row.stock_boxes),
    reorderLevel: round3(row.reorder_level),
    batchNo: row.batch_no ?? '',
    notes: row.notes ?? '',
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };

  const { pricePerSqft, pricePerBox } = productRates(base);
  return {
    ...base,
    pricePerSqft,
    pricePerBox,
    stockSqft: round2(base.stockBoxes * base.sqftPerBox),
    stockValueCost: round2(base.stockBoxes * base.costPerBox),
    stockValueRetail: round2(
      base.stockBoxes * (base.sellUnit === 'box' ? base.price : base.price * base.sqftPerBox)
    ),
    isLowStock: base.reorderLevel > 0 && base.stockBoxes <= base.reorderLevel
  };
}

function mapCustomer(row) {
  return {
    id: Number(row.id),
    name: row.name,
    phone: row.phone ?? '',
    email: row.email ?? '',
    gstin: row.gstin ?? '',
    type: row.type ?? 'Retail',
    address: row.address ?? '',
    city: row.city ?? '',
    state: row.state ?? '',
    pincode: row.pincode ?? '',
    notes: row.notes ?? '',
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    outstanding: round2(row.outstanding ?? 0),
    invoiceCount: Number(row.invoice_count ?? 0),
    lastInvoiceDate: row.last_invoice_date ?? null
  };
}

function mapInvoice(row) {
  return {
    id: Number(row.id),
    invoiceNo: row.invoice_no,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    customerId: row.customer_id ? Number(row.customer_id) : null,
    customerName: row.customer_name,
    customerPhone: row.customer_phone ?? '',
    customerGstin: row.customer_gstin ?? '',
    billingAddress: row.billing_address ?? '',
    shippingAddress: row.shipping_address ?? '',
    customerState: row.customer_state ?? '',
    placeOfSupply: row.place_of_supply,
    stateCode: row.state_code ?? '',
    subtotal: round2(row.subtotal),
    discountTotal: round2(row.discount_total),
    taxableTotal: round2(row.taxable_total),
    cgst: round2(row.cgst),
    sgst: round2(row.sgst),
    igst: round2(row.igst),
    roundOff: round2(row.round_off),
    total: round2(row.total),
    amountPaid: round2(row.amount_paid),
    balance: round2(row.balance),
    paymentStatus: row.payment_status,
    status: row.status,
    notes: row.notes ?? '',
    terms: row.terms ?? '',
    createdAt: row.created_at,
    voidedAt: row.voided_at,
    voidReason: row.void_reason ?? '',
    itemCount: Number(row.item_count ?? 0),
    isInterState: round2(row.igst) > 0
  };
}

function mapInvoiceItem(row) {
  const qty = toNumber(row.qty);
  const sqftPerBox = toNumber(row.sqft_per_box);
  return {
    id: Number(row.id),
    invoiceId: Number(row.invoice_id),
    productId: row.product_id ? Number(row.product_id) : null,
    name: row.name,
    sku: row.sku ?? '',
    hsn: row.hsn ?? '',
    qty: round3(qty),
    unit: row.unit,
    sqftPerBox: round2(sqftPerBox),
    rate: round2(row.rate),
    discountPct: round2(row.discount_pct),
    gross: round2(row.gross),
    discount: round2(row.discount),
    taxable: round2(row.taxable),
    gstRate: round2(row.gst_rate),
    cgst: round2(row.cgst),
    sgst: round2(row.sgst),
    igst: round2(row.igst),
    lineTotal: round2(row.line_total),
    stockBoxes: round3(row.stock_boxes),
    sortOrder: Number(row.sort_order ?? 0),
    areaSqft: row.unit === 'sqft' ? round2(qty) : round2(qty * sqftPerBox)
  };
}

function mapPayment(row) {
  return {
    id: Number(row.id),
    invoiceId: Number(row.invoice_id),
    paymentDate: row.payment_date,
    amount: round2(row.amount),
    method: row.method,
    reference: row.reference ?? '',
    notes: row.notes ?? '',
    createdAt: row.created_at,
    invoiceNo: row.invoice_no ?? null,
    customerName: row.customer_name ?? null
  };
}

function mapMovement(row) {
  return {
    id: Number(row.id),
    productId: Number(row.product_id),
    productName: row.product_name,
    productSku: row.product_sku ?? '',
    date: row.movement_date,
    type: row.type,
    qtyBoxes: round3(row.qty_boxes),
    unitCost: round2(row.unit_cost),
    reference: row.reference ?? '',
    notes: row.notes ?? '',
    invoiceId: row.invoice_id ? Number(row.invoice_id) : null,
    invoiceNo: row.invoice_no ?? null,
    createdAt: row.created_at
  };
}

const CUSTOMER_SELECT = `
  SELECT c.*,
    COALESCE((
      SELECT SUM(i.balance) FROM invoices i
      WHERE i.customer_id = c.id AND i.status = 'active' AND i.balance > 0.004
    ), 0) AS outstanding,
    (
      SELECT COUNT(*) FROM invoices i
      WHERE i.customer_id = c.id AND i.status = 'active'
    ) AS invoice_count,
    (
      SELECT MAX(i.invoice_date) FROM invoices i
      WHERE i.customer_id = c.id AND i.status = 'active'
    ) AS last_invoice_date
  FROM customers c
`;

export class BillingRepository {
  constructor(db) {
    this.db = db;
  }

  getSettings() {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'settings'").get();
    let stored = {};
    try {
      stored = row ? JSON.parse(row.value) : {};
    } catch {
      stored = {};
    }
    return { ...DEFAULT_SETTINGS, ...stored };
  }

  updateSettings(patch = {}) {
    const current = this.getSettings();
    const next = { ...current };

    for (const [key, defaultValue] of Object.entries(DEFAULT_SETTINGS)) {
      if (!(key in patch)) continue;
      if (typeof defaultValue === 'boolean') {
        next[key] = Boolean(patch[key]);
      } else if (typeof defaultValue === 'number') {
        next[key] = validNumber(patch[key], key, { min: 0, max: 100000 });
      } else {
        next[key] = cleanMultiline(patch[key], key === 'terms' ? 2000 : 300);
      }
    }

    if ('state' in patch) {
      const state = normaliseState(patch.state);
      next.state = state.name;
      next.stateCode = state.code;
    } else if ('stateCode' in patch) {
      const state = normaliseState(patch.stateCode);
      next.state = state.name;
      next.stateCode = state.code;
    }

    if ('gstin' in patch) next.gstin = normaliseGstin(patch.gstin);
    if ('pan' in patch) next.pan = cleanText(patch.pan, 10).toUpperCase();
    if ('invoicePrefix' in patch) {
      const prefix = cleanText(patch.invoicePrefix, 16).toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9/-]{0,15}$/.test(prefix)) {
        throw new Error('Invoice prefix may contain letters, numbers, hyphens and slashes only.');
      }
      next.invoicePrefix = prefix;
    }
    if ('defaultGstRate' in patch) {
      const rate = Number(patch.defaultGstRate);
      if (!GST_RATES.includes(rate)) throw new Error('Choose a valid GST rate.');
      next.defaultGstRate = rate;
    }
    if ('dueDays' in patch) {
      next.dueDays = Math.round(validNumber(patch.dueDays, 'Credit period', { min: 0, max: 365 }));
    }
    if ('jurisdiction' in patch) next.jurisdiction = cleanText(patch.jurisdiction, 120);
    next.showroomName = requireText(next.showroomName, 'Showroom name', 120);

    this.db
      .prepare(
        "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
      .run(JSON.stringify(next));
    return next;
  }

  getCategories() {
    const rows = this.db
      .prepare("SELECT DISTINCT category FROM products WHERE category <> '' ORDER BY category COLLATE NOCASE")
      .all();
    return [...new Set([...PRODUCT_CATEGORIES, ...rows.map((row) => row.category)])];
  }

  listProducts({ search = '', category = '', lowStock = false, includeArchived = false } = {}) {
    const where = [];
    const params = [];

    if (!includeArchived) where.push('active = 1');
    if (search) {
      const query = `%${cleanText(search, 80)}%`;
      where.push('(name LIKE ? OR brand LIKE ? OR sku LIKE ? OR size LIKE ? OR category LIKE ?)');
      params.push(query, query, query, query, query);
    }
    if (category) {
      where.push('category = ?');
      params.push(category);
    }
    if (lowStock) {
      where.push('active = 1 AND reorder_level > 0 AND stock_boxes <= reorder_level');
    }

    const sql = `SELECT * FROM products${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
      ORDER BY active DESC, name COLLATE NOCASE`;
    return this.db.prepare(sql).all(...params).map(mapProduct);
  }

  getProduct(id) {
    const row = this.db.prepare('SELECT * FROM products WHERE id = ?').get(Number(id));
    if (!row) throw new Error('Item not found.');
    return mapProduct(row);
  }

  normaliseProductInput(input = {}, existing = null) {
    const value = (key, fallback) => input[key] ?? existing?.[key] ?? fallback;
    const name = requireText(value('name', ''), 'Item name', 120);
    const category = cleanText(value('category', 'Floor Tile'), 60) || 'Floor Tile';
    const sellUnit = value('sellUnit', 'sqft') === 'box' ? 'box' : 'sqft';
    const sqftPerBox = validNumber(value('sqftPerBox', 0), 'Area per box', { min: 0, max: 10000 });
    if (sellUnit === 'sqft' && sqftPerBox <= 0) {
      throw new Error('Area per box is required when the selling rate is per sq ft.');
    }
    const gstRate = Number(value('gstRate', 18));
    if (!GST_RATES.includes(gstRate)) throw new Error('Choose a valid GST rate.');
    const sku = cleanText(value('sku', ''), 40).toUpperCase();

    return {
      sku: sku || null,
      name,
      brand: cleanText(value('brand', ''), 60),
      category,
      size: cleanText(value('size', ''), 40),
      finish: cleanText(value('finish', ''), 40),
      hsn: cleanText(value('hsn', '6907'), 20),
      gstRate,
      sellUnit,
      price: round2(validNumber(value('price', 0), 'Selling rate', { min: 0, max: 10000000 })),
      costPerBox: round2(validNumber(value('costPerBox', 0), 'Cost per box', { min: 0, max: 10000000 })),
      sqftPerBox: round2(sqftPerBox),
      pcsPerBox: Math.round(validNumber(value('pcsPerBox', 0), 'Pieces per box', { min: 0, max: 1000 })),
      reorderLevel: round3(validNumber(value('reorderLevel', 0), 'Reorder level', { min: 0, max: 100000 })),
      batchNo: cleanText(value('batchNo', ''), 40),
      notes: cleanMultiline(value('notes', ''), 500)
    };
  }

  createProduct(input = {}) {
    const product = this.normaliseProductInput(input);
    const stockBoxes = validNumber(input.stockBoxes ?? 0, 'Opening stock', { min: 0, max: 1000000 });
    const now = nowIso();

    try {
      return withTransaction(this.db, () => {
        const result = this.db
          .prepare(`
            INSERT INTO products (
              sku, name, brand, category, size, finish, hsn, gst_rate, sell_unit, price,
              cost_per_box, sqft_per_box, pcs_per_box, stock_boxes, reorder_level, batch_no,
              notes, active, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
          `)
          .run(
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
            round3(stockBoxes),
            product.reorderLevel,
            product.batchNo,
            product.notes,
            now,
            now
          );

        const id = Number(result.lastInsertRowid);
        if (stockBoxes > 0) {
          this.db
            .prepare(`
              INSERT INTO stock_movements (
                product_id, movement_date, type, qty_boxes, unit_cost, reference, notes, invoice_id, created_at
              ) VALUES (?, ?, 'opening', ?, ?, 'Opening stock', '', NULL, ?)
            `)
            .run(id, todayISO(), round3(stockBoxes), product.costPerBox, now);
        }
        return this.getProduct(id);
      });
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed: products.sku')) {
        throw new Error('This item code is already in use.');
      }
      throw error;
    }
  }

  updateProduct(id, input = {}) {
    const existing = this.getProduct(id);
    const product = this.normaliseProductInput(input, existing);

    try {
      this.db
        .prepare(`
          UPDATE products SET
            sku = ?, name = ?, brand = ?, category = ?, size = ?, finish = ?, hsn = ?,
            gst_rate = ?, sell_unit = ?, price = ?, cost_per_box = ?, sqft_per_box = ?,
            pcs_per_box = ?, reorder_level = ?, batch_no = ?, notes = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(
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
          product.reorderLevel,
          product.batchNo,
          product.notes,
          nowIso(),
          Number(id)
        );
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed: products.sku')) {
        throw new Error('This item code is already in use.');
      }
      throw error;
    }
    return this.getProduct(id);
  }

  setProductActive(id, active) {
    const product = this.getProduct(id);
    this.db
      .prepare('UPDATE products SET active = ?, updated_at = ? WHERE id = ?')
      .run(active ? 1 : 0, nowIso(), product.id);
    return this.getProduct(product.id);
  }

  adjustStock(id, { qtyBoxes, reason, date } = {}) {
    const product = this.getProduct(id);
    const delta = round3(Number(qtyBoxes));
    if (!Number.isFinite(delta) || delta === 0) throw new Error('Enter a stock change other than zero.');
    const note = requireText(reason, 'Reason', 200);
    const movementDate = assertDate(date || todayISO(), 'Adjustment date');
    const newStock = round3(product.stockBoxes + delta);
    if (newStock < 0) throw new Error('Stock cannot be reduced below zero.');

    return withTransaction(this.db, () => {
      const now = nowIso();
      this.db
        .prepare('UPDATE products SET stock_boxes = ?, updated_at = ? WHERE id = ?')
        .run(newStock, now, product.id);
      this.db
        .prepare(`
          INSERT INTO stock_movements (
            product_id, movement_date, type, qty_boxes, unit_cost, reference, notes, invoice_id, created_at
          ) VALUES (?, ?, 'adjustment', ?, ?, ?, '', NULL, ?)
        `)
        .run(product.id, movementDate, delta, product.costPerBox, note, now);
      return this.getProduct(product.id);
    });
  }

  listCustomers({ search = '', type = '', includeArchived = false } = {}) {
    const where = [];
    const params = [];
    if (!includeArchived) where.push('c.active = 1');
    if (type) {
      where.push('c.type = ?');
      params.push(type);
    }
    if (search) {
      const query = `%${cleanText(search, 80)}%`;
      where.push('(c.name LIKE ? OR c.phone LIKE ? OR c.gstin LIKE ? OR c.city LIKE ?)');
      params.push(query, query, query, query);
    }
    const sql = `${CUSTOMER_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
      ORDER BY c.active DESC, c.name COLLATE NOCASE`;
    return this.db.prepare(sql).all(...params).map(mapCustomer);
  }

  getCustomerSummary(id) {
    const row = this.db.prepare(`${CUSTOMER_SELECT} WHERE c.id = ?`).get(Number(id));
    if (!row) throw new Error('Customer not found.');
    return mapCustomer(row);
  }

  getCustomer(id) {
    const customer = this.getCustomerSummary(id);
    const invoices = this.listInvoices({ customerId: customer.id, status: 'all', page: 1, pageSize: 100 }).items;
    const payments = this.db
      .prepare(`
        SELECT p.*, i.invoice_no, i.customer_name
        FROM payments p JOIN invoices i ON i.id = p.invoice_id
        WHERE i.customer_id = ?
        ORDER BY p.payment_date DESC, p.id DESC
        LIMIT 100
      `)
      .all(customer.id)
      .map(mapPayment);
    return { customer, invoices, payments };
  }

  normaliseCustomerInput(input = {}, existing = null) {
    const value = (key, fallback) => input[key] ?? existing?.[key] ?? fallback;
    const state = normaliseState(value('state', 'Tamil Nadu'));
    const type = cleanText(value('type', 'Retail'), 40) || 'Retail';
    const email = cleanText(value('email', ''), 120);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Enter a valid email address.');
    }

    return {
      name: requireText(value('name', ''), 'Customer name', 120),
      phone: cleanText(value('phone', ''), 30),
      email,
      gstin: normaliseGstin(value('gstin', '')),
      type: CUSTOMER_TYPES.includes(type) ? type : 'Retail',
      address: cleanMultiline(value('address', ''), 300),
      city: cleanText(value('city', ''), 80),
      state: state.name,
      pincode: cleanText(value('pincode', ''), 10),
      notes: cleanMultiline(value('notes', ''), 500)
    };
  }

  createCustomer(input = {}) {
    const customer = this.normaliseCustomerInput(input);
    const now = nowIso();
    const result = this.db
      .prepare(`
        INSERT INTO customers (
          name, phone, email, gstin, type, address, city, state, pincode, notes, active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `)
      .run(
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
    return this.getCustomerSummary(Number(result.lastInsertRowid));
  }

  updateCustomer(id, input = {}) {
    const existing = this.getCustomerSummary(id);
    const customer = this.normaliseCustomerInput(input, existing);
    this.db
      .prepare(`
        UPDATE customers SET
          name = ?, phone = ?, email = ?, gstin = ?, type = ?, address = ?, city = ?,
          state = ?, pincode = ?, notes = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
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
        nowIso(),
        existing.id
      );
    return this.getCustomerSummary(existing.id);
  }

  setCustomerActive(id, active) {
    const customer = this.getCustomerSummary(id);
    this.db
      .prepare('UPDATE customers SET active = ?, updated_at = ? WHERE id = ?')
      .run(active ? 1 : 0, nowIso(), customer.id);
    return this.getCustomerSummary(customer.id);
  }

  nextInvoiceNumber() {
    const settings = this.getSettings();
    const sequence = this.db.prepare("SELECT next_value FROM sequences WHERE name = 'invoice'").get();
    let next = Number(sequence?.next_value ?? 1);
    const exists = this.db.prepare('SELECT 1 FROM invoices WHERE invoice_no = ?');
    let invoiceNo;
    do {
      invoiceNo = `${settings.invoicePrefix}-${String(next).padStart(4, '0')}`;
      next += 1;
    } while (exists.get(invoiceNo));

    this.db
      .prepare("UPDATE sequences SET next_value = ? WHERE name = 'invoice'")
      .run(next);
    return invoiceNo;
  }

  getInvoice(id) {
    const row = this.db.prepare('SELECT * FROM invoices WHERE id = ?').get(Number(id));
    if (!row) throw new Error('Invoice not found.');
    const invoice = mapInvoice(row);
    invoice.items = this.db
      .prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order, id')
      .all(invoice.id)
      .map(mapInvoiceItem);
    invoice.payments = this.db
      .prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date, id')
      .all(invoice.id)
      .map(mapPayment);
    invoice.itemCount = invoice.items.length;
    return invoice;
  }

  listInvoices({
    search = '',
    status = 'all',
    from = '',
    to = '',
    customerId = null,
    page = 1,
    pageSize = 25
  } = {}) {
    const where = [];
    const params = [];
    if (search) {
      const query = `%${cleanText(search, 80)}%`;
      where.push('(i.invoice_no LIKE ? OR i.customer_name LIKE ? OR i.customer_phone LIKE ?)');
      params.push(query, query, query);
    }
    if (from) {
      where.push('i.invoice_date >= ?');
      params.push(assertDate(from, 'From date'));
    }
    if (to) {
      where.push('i.invoice_date <= ?');
      params.push(assertDate(to, 'To date'));
    }
    if (customerId) {
      where.push('i.customer_id = ?');
      params.push(Number(customerId));
    }

    if (status === 'outstanding') {
      where.push("i.status = 'active' AND i.balance > 0.004");
    } else if (['paid', 'partial', 'unpaid'].includes(status)) {
      where.push("i.status = 'active' AND i.payment_status = ?");
      params.push(status);
    } else if (status === 'void') {
      where.push("i.status = 'void'");
    } else if (status === 'active') {
      where.push("i.status = 'active'");
    }

    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const countRow = this.db.prepare(`SELECT COUNT(*) AS count FROM invoices i${whereSql}`).get(...params);
    const total = Number(countRow?.count ?? 0);
    const safePageSize = Math.min(Math.max(Number(pageSize) || 25, 1), 100);
    const safePage = Math.max(Number(page) || 1, 1);
    const offset = (safePage - 1) * safePageSize;

    const rows = this.db
      .prepare(`
        SELECT i.*, (
          SELECT COUNT(*) FROM invoice_items ii WHERE ii.invoice_id = i.id
        ) AS item_count
        FROM invoices i${whereSql}
        ORDER BY i.invoice_date DESC, i.id DESC
        LIMIT ? OFFSET ?
      `)
      .all(...params, safePageSize, offset);

    return {
      items: rows.map(mapInvoice),
      total,
      page: safePage,
      pageSize: safePageSize,
      pages: Math.max(Math.ceil(total / safePageSize), 1)
    };
  }

  prepareInvoiceItems(items) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('Add at least one item to the bill.');
    }
    if (items.length > 100) throw new Error('An invoice can have at most 100 items.');

    return items.map((raw, index) => {
      const productId = raw.productId ? Number(raw.productId) : null;
      let product = null;
      let name;
      let sku = '';
      let hsn;
      let gstRate;
      let sqftPerBox = 0;

      if (productId) {
        const row = this.db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
        if (!row) throw new Error(`Item on line ${index + 1} was not found.`);
        if (!row.active) throw new Error(`"${row.name}" is archived and cannot be billed.`);
        product = mapProduct(row);
        name = product.name;
        sku = product.sku;
        hsn = product.hsn;
        gstRate = product.gstRate;
        sqftPerBox = product.sqftPerBox;
      } else {
        name = requireText(raw.name, `Item name on line ${index + 1}`, 120);
        hsn = cleanText(raw.hsn, 20);
        gstRate = Number(raw.gstRate);
        if (!GST_RATES.includes(gstRate)) throw new Error(`GST rate on line ${index + 1} is invalid.`);
        sqftPerBox = validNumber(raw.sqftPerBox ?? 0, `Area per box on line ${index + 1}`, {
          min: 0,
          max: 10000
        });
      }

      const unit = raw.unit === 'box' ? 'box' : raw.unit === 'sqft' ? 'sqft' : null;
      if (!unit) throw new Error(`Choose a billing unit on line ${index + 1}.`);
      if (product && unit === 'sqft' && sqftPerBox <= 0) {
        throw new Error(`"${name}" does not have a pack area, so it can only be billed by box.`);
      }

      const qty = validNumber(raw.qty, `Quantity on line ${index + 1}`, { min: 0.001, max: 1000000 });
      let rate;
      if (raw.rate === '' || raw.rate == null) {
        const { pricePerSqft, pricePerBox } = product
          ? productRates(product)
          : { pricePerSqft: null, pricePerBox: null };
        rate = unit === 'sqft' ? pricePerSqft : pricePerBox;
        if (rate == null) throw new Error(`Enter a rate for line ${index + 1}.`);
      } else {
        rate = validNumber(raw.rate, `Rate on line ${index + 1}`, { min: 0, max: 10000000 });
      }

      const discountPct = validNumber(raw.discountPct ?? 0, `Discount on line ${index + 1}`, {
        min: 0,
        max: 100
      });

      return {
        productId: product?.id ?? null,
        product,
        name,
        sku,
        hsn,
        unit,
        sqftPerBox,
        qty,
        rate,
        discountPct,
        gstRate
      };
    });
  }

  createInvoice(payload = {}) {
    const settings = this.getSettings();
    const invoiceDate = assertDate(payload.invoiceDate || todayISO(), 'Invoice date');
    const items = this.prepareInvoiceItems(payload.items);

    let customer = null;
    if (payload.customerId) {
      const row = this.db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(payload.customerId));
      if (!row) throw new Error('Customer not found.');
      if (!row.active) throw new Error('This customer is archived. Restore the customer before billing.');
      customer = mapCustomer(row);
    }

    const customerName = customer?.name ?? (cleanText(payload.customerName, 120) || 'Walk-in Customer');
    const customerPhone = cleanText(payload.customerPhone, 30) || customer?.phone || '';
    const customerGstin = customer?.gstin || normaliseGstin(payload.customerGstin);
    const customerState = customer?.state ?? cleanText(payload.customerState, 80);
    const state = normaliseState(payload.placeOfSupply || customerState || settings.state);

    const billingParts = [];
    if (customer) {
      if (customer.address) billingParts.push(customer.address);
      const cityLine = [customer.city, customer.pincode].filter(Boolean).join(' - ');
      if (cityLine) billingParts.push(cityLine);
    } else if (payload.billingAddress) {
      billingParts.push(cleanMultiline(payload.billingAddress, 400));
    }
    const billingAddress = billingParts.join('\n');
    const shippingAddress = cleanMultiline(payload.shippingAddress, 400);

    const intraState = state.code === settings.stateCode;
    const totals = computeInvoice(items, {
      intraState,
      roundOff: Boolean(settings.roundOffEnabled)
    });

    const amountPaid = round2(validNumber(payload.amountPaid ?? 0, 'Amount received', { min: 0 }));
    if (amountPaid > totals.total + 0.009) {
      throw new Error('Amount received cannot be more than the invoice total.');
    }
    const { balance, paymentStatus } = derivePaymentStatus(totals.total, amountPaid);
    const method = amountPaid > 0 ? cleanText(payload.paymentMethod || 'Cash', 30) : '';
    if (amountPaid > 0 && !PAYMENT_METHODS.includes(method)) {
      throw new Error('Choose a valid payment method.');
    }

    const requestedDueDate = payload.dueDate ? assertDate(payload.dueDate, 'Due date') : '';
    if (requestedDueDate && requestedDueDate < invoiceDate) {
      throw new Error('Due date cannot be before the invoice date.');
    }
    const dueDate =
      requestedDueDate || (balance > 0 ? addDaysISO(invoiceDate, settings.dueDays) : invoiceDate);
    const notes = cleanMultiline(payload.notes, 2000);
    const now = nowIso();

    const invoiceId = withTransaction(this.db, () => {
      const invoiceNo = this.nextInvoiceNumber();
      const result = this.db
        .prepare(`
          INSERT INTO invoices (
            invoice_no, invoice_date, due_date, customer_id, customer_name, customer_phone,
            customer_gstin, billing_address, shipping_address, customer_state, place_of_supply,
            state_code, subtotal, discount_total, taxable_total, cgst, sgst, igst, round_off,
            total, amount_paid, balance, payment_status, status, notes, terms, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
        `)
        .run(
          invoiceNo,
          invoiceDate,
          dueDate,
          customer?.id ?? null,
          customerName,
          customerPhone,
          customerGstin,
          billingAddress,
          shippingAddress,
          customerState || state.name,
          state.name,
          state.code,
          totals.subtotal,
          totals.discountTotal,
          totals.taxableTotal,
          totals.cgst,
          totals.sgst,
          totals.igst,
          totals.roundOff,
          totals.total,
          amountPaid,
          balance,
          paymentStatus,
          notes,
          settings.terms,
          now
        );

      const id = Number(result.lastInsertRowid);
      const insertItem = this.db.prepare(`
        INSERT INTO invoice_items (
          invoice_id, product_id, name, sku, hsn, qty, unit, sqft_per_box, rate,
          discount_pct, gross, discount, taxable, gst_rate, cgst, sgst, igst,
          line_total, stock_boxes, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const updateStock = this.db.prepare(
        'UPDATE products SET stock_boxes = ?, updated_at = ? WHERE id = ?'
      );
      const insertMovement = this.db.prepare(`
        INSERT INTO stock_movements (
          product_id, movement_date, type, qty_boxes, unit_cost, reference, notes, invoice_id, created_at
        ) VALUES (?, ?, 'sale', ?, ?, ?, '', ?, ?)
      `);

      totals.lines.forEach((line, index) => {
        insertItem.run(
          id,
          line.productId,
          line.name,
          line.sku,
          line.hsn,
          line.qty,
          line.unit,
          line.sqftPerBox,
          line.rate,
          line.discountPct,
          line.gross,
          line.discount,
          line.taxable,
          line.gstRate,
          line.cgst,
          line.sgst,
          line.igst,
          line.total,
          line.boxes,
          index
        );

        if (line.productId && line.boxes > 0) {
          const current = this.db.prepare('SELECT stock_boxes, cost_per_box FROM products WHERE id = ?').get(line.productId);
          const newStock = round3(Number(current.stock_boxes) - line.boxes);
          updateStock.run(newStock, now, line.productId);
          insertMovement.run(
            line.productId,
            invoiceDate,
            -Math.abs(line.boxes),
            current.cost_per_box,
            invoiceNo,
            id,
            now
          );
        }
      });

      if (amountPaid > 0) {
        this.db
          .prepare(`
            INSERT INTO payments (invoice_id, payment_date, amount, method, reference, notes, created_at)
            VALUES (?, ?, ?, ?, ?, '', ?)
          `)
          .run(
            id,
            invoiceDate,
            amountPaid,
            method,
            cleanText(payload.paymentReference, 100),
            now
          );
      }

      return id;
    });

    return this.getInvoice(invoiceId);
  }

  addPayment(invoiceId, payload = {}) {
    const id = Number(invoiceId);
    const invoice = this.getInvoice(id);
    if (invoice.status !== 'active') throw new Error('Payments cannot be recorded on a cancelled invoice.');
    if (invoice.balance <= 0.004) throw new Error('This invoice is already fully paid.');

    const amount = round2(validNumber(payload.amount, 'Payment amount', { min: 0.01 }));
    if (amount > invoice.balance + 0.009) throw new Error('Payment cannot be more than the balance due.');
    const method = cleanText(payload.method || 'Cash', 30);
    if (!PAYMENT_METHODS.includes(method)) throw new Error('Choose a valid payment method.');
    const paymentDate = assertDate(payload.paymentDate || todayISO(), 'Payment date');
    const now = nowIso();

    withTransaction(this.db, () => {
      this.db
        .prepare(`
          INSERT INTO payments (invoice_id, payment_date, amount, method, reference, notes, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          paymentDate,
          amount,
          method,
          cleanText(payload.reference, 100),
          cleanMultiline(payload.notes, 500),
          now
        );
      const paid = round2(invoice.amountPaid + amount);
      const { balance, paymentStatus } = derivePaymentStatus(invoice.total, paid);
      this.db
        .prepare('UPDATE invoices SET amount_paid = ?, balance = ?, payment_status = ? WHERE id = ?')
        .run(paid, balance, paymentStatus, id);
    });

    return this.getInvoice(id);
  }

  deletePayment(paymentId) {
    const payment = this.db.prepare('SELECT * FROM payments WHERE id = ?').get(Number(paymentId));
    if (!payment) throw new Error('Payment not found.');
    const invoice = this.getInvoice(payment.invoice_id);
    if (invoice.status !== 'active') throw new Error('Payments on a cancelled invoice cannot be changed.');

    withTransaction(this.db, () => {
      this.db.prepare('DELETE FROM payments WHERE id = ?').run(Number(paymentId));
      const sum = this.db
        .prepare('SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE invoice_id = ?')
        .get(invoice.id);
      const paid = round2(sum.paid);
      const { balance, paymentStatus } = derivePaymentStatus(invoice.total, paid);
      this.db
        .prepare('UPDATE invoices SET amount_paid = ?, balance = ?, payment_status = ? WHERE id = ?')
        .run(paid, balance, paymentStatus, invoice.id);
    });

    return this.getInvoice(invoice.id);
  }

  voidInvoice(invoiceId, reason = '') {
    const invoice = this.getInvoice(Number(invoiceId));
    if (invoice.status === 'void') throw new Error('This invoice is already cancelled.');
    const note = cleanText(reason, 300) || 'Cancelled by showroom';

    withTransaction(this.db, () => {
      const now = nowIso();
      this.db
        .prepare(`
          UPDATE invoices SET status = 'void', payment_status = 'void', balance = 0,
            voided_at = ?, void_reason = ? WHERE id = ?
        `)
        .run(now, note, invoice.id);

      const updateStock = this.db.prepare(
        'UPDATE products SET stock_boxes = ?, updated_at = ? WHERE id = ?'
      );
      const insertMovement = this.db.prepare(`
        INSERT INTO stock_movements (
          product_id, movement_date, type, qty_boxes, unit_cost, reference, notes, invoice_id, created_at
        ) VALUES (?, ?, 'void', ?, ?, ?, ?, ?, ?)
      `);

      for (const item of invoice.items) {
        if (!item.productId || item.stockBoxes <= 0) continue;
        const product = this.db
          .prepare('SELECT stock_boxes, cost_per_box FROM products WHERE id = ?')
          .get(item.productId);
        if (!product) continue;
        updateStock.run(round3(Number(product.stock_boxes) + item.stockBoxes), now, item.productId);
        insertMovement.run(
          item.productId,
          todayISO(),
          Math.abs(item.stockBoxes),
          product.cost_per_box,
          invoice.invoiceNo,
          note,
          invoice.id,
          now
        );
      }
    });

    return this.getInvoice(invoice.id);
  }

  listStockMovements({ productId = null, search = '', limit = 100 } = {}) {
    const where = [];
    const params = [];
    if (productId) {
      where.push('m.product_id = ?');
      params.push(Number(productId));
    }
    if (search) {
      const query = `%${cleanText(search, 80)}%`;
      where.push('(p.name LIKE ? OR p.sku LIKE ? OR m.reference LIKE ? OR m.notes LIKE ?)');
      params.push(query, query, query, query);
    }
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 300);
    const sql = `
      SELECT m.*, p.name AS product_name, p.sku AS product_sku, i.invoice_no
      FROM stock_movements m
      JOIN products p ON p.id = m.product_id
      LEFT JOIN invoices i ON i.id = m.invoice_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY m.movement_date DESC, m.id DESC
      LIMIT ?
    `;
    return this.db.prepare(sql).all(...params, safeLimit).map(mapMovement);
  }

  createStockIn(payload = {}) {
    const movementDate = assertDate(payload.date || todayISO(), 'Stock-in date');
    const supplier = cleanText(payload.supplier, 120);
    const notes = cleanMultiline(payload.notes, 500);
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (!items.length) throw new Error('Add at least one item to record stock in.');
    if (items.length > 100) throw new Error('A stock entry can have at most 100 items.');

    const prepared = items.map((item, index) => {
      const productId = Number(item.productId);
      const row = productId ? this.db.prepare('SELECT * FROM products WHERE id = ?').get(productId) : null;
      if (!row) throw new Error(`Item on line ${index + 1} was not found.`);
      const qty = validNumber(item.qtyBoxes, `Quantity on line ${index + 1}`, {
        min: 0.001,
        max: 1000000
      });
      const cost = validNumber(item.costPerBox ?? 0, `Cost on line ${index + 1}`, {
        min: 0,
        max: 10000000
      });
      return { product: mapProduct(row), qty: round3(qty), cost: round2(cost) };
    });

    withTransaction(this.db, () => {
      const now = nowIso();
      for (const line of prepared) {
        const oldStock = line.product.stockBoxes;
        const newStock = round3(oldStock + line.qty);
        const newCost =
          line.cost > 0
            ? oldStock > 0 && line.product.costPerBox > 0
              ? round2(
                  (oldStock * line.product.costPerBox + line.qty * line.cost) / (oldStock + line.qty)
                )
              : line.cost
            : line.product.costPerBox;

        this.db
          .prepare('UPDATE products SET stock_boxes = ?, cost_per_box = ?, updated_at = ? WHERE id = ?')
          .run(newStock, newCost, now, line.product.id);
        this.db
          .prepare(`
            INSERT INTO stock_movements (
              product_id, movement_date, type, qty_boxes, unit_cost, reference, notes, invoice_id, created_at
            ) VALUES (?, ?, 'purchase', ?, ?, ?, ?, NULL, ?)
          `)
          .run(line.product.id, movementDate, line.qty, line.cost, supplier, notes, now);
      }
    });

    return { updated: prepared.length, supplier, date: movementDate };
  }

  getDashboard() {
    const today = todayISO();
    const monthStart = `${today.slice(0, 7)}-01`;
    const seriesStart = addDaysISO(today, -13);

    const todaySales = this.db
      .prepare(`
        SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS count
        FROM invoices WHERE status = 'active' AND invoice_date = ?
      `)
      .get(today);

    const monthSales = this.db
      .prepare(`
        SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS count
        FROM invoices WHERE status = 'active' AND invoice_date BETWEEN ? AND ?
      `)
      .get(monthStart, today);

    const collected = this.db
      .prepare(`
        SELECT COALESCE(SUM(p.amount), 0) AS total
        FROM payments p JOIN invoices i ON i.id = p.invoice_id
        WHERE i.status = 'active' AND p.payment_date BETWEEN ? AND ?
      `)
      .get(monthStart, today);

    const outstanding = this.db
      .prepare(`
        SELECT COALESCE(SUM(balance), 0) AS total, COUNT(*) AS count
        FROM invoices WHERE status = 'active' AND balance > 0.004
      `)
      .get();

    const lowStockRows = this.db
      .prepare(`
        SELECT * FROM products
        WHERE active = 1 AND reorder_level > 0 AND stock_boxes <= reorder_level
        ORDER BY (stock_boxes - reorder_level) ASC, name COLLATE NOCASE
        LIMIT 6
      `)
      .all();

    const lowStockTotal = this.db
      .prepare(`
        SELECT COUNT(*) AS count FROM products
        WHERE active = 1 AND reorder_level > 0 AND stock_boxes <= reorder_level
      `)
      .get();

    const seriesRows = this.db
      .prepare(`
        SELECT invoice_date AS date, COALESCE(SUM(total), 0) AS total, COUNT(*) AS count
        FROM invoices
        WHERE status = 'active' AND invoice_date BETWEEN ? AND ?
        GROUP BY invoice_date
      `)
      .all(seriesStart, today);
    const seriesMap = new Map(seriesRows.map((row) => [row.date, row]));
    const series = chunkDateSeries(seriesStart, today).map((date) => ({
      date,
      total: round2(seriesMap.get(date)?.total ?? 0),
      count: Number(seriesMap.get(date)?.count ?? 0)
    }));

    const recentInvoices = this.db
      .prepare(`
        SELECT i.*, (
          SELECT COUNT(*) FROM invoice_items ii WHERE ii.invoice_id = i.id
        ) AS item_count
        FROM invoices i
        WHERE i.status = 'active'
        ORDER BY i.created_at DESC, i.id DESC
        LIMIT 6
      `)
      .all()
      .map(mapInvoice);

    const topProducts = this.db
      .prepare(`
        SELECT ii.name, ii.sku,
          COALESCE(SUM(ii.qty * CASE WHEN ii.unit = 'sqft' THEN 1 ELSE ii.sqft_per_box END), 0) AS area_sqft,
          COALESCE(SUM(ii.line_total), 0) AS revenue
        FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
        WHERE i.status = 'active' AND i.invoice_date BETWEEN ? AND ?
        GROUP BY ii.name, ii.sku
        ORDER BY revenue DESC
        LIMIT 5
      `)
      .all(addDaysISO(today, -29), today)
      .map((row) => ({
        name: row.name,
        sku: row.sku ?? '',
        areaSqft: round2(row.area_sqft),
        revenue: round2(row.revenue)
      }));

    return {
      today,
      monthStart,
      todaySales: round2(todaySales.total),
      todayCount: Number(todaySales.count),
      monthSales: round2(monthSales.total),
      monthCount: Number(monthSales.count),
      monthCollected: round2(collected.total),
      outstanding: round2(outstanding.total),
      outstandingCount: Number(outstanding.count),
      lowStock: lowStockRows.map(mapProduct),
      lowStockCount: Number(lowStockTotal.count),
      series,
      recentInvoices,
      topProducts
    };
  }

  reportSales({ from, to } = {}) {
    const start = assertDate(from, 'From date');
    const end = assertDate(to, 'To date');
    if (start > end) throw new Error('The start date must be before the end date.');

    const summary = this.db
      .prepare(`
        SELECT
          COUNT(*) AS invoice_count,
          COALESCE(SUM(total), 0) AS total,
          COALESCE(SUM(subtotal), 0) AS subtotal,
          COALESCE(SUM(discount_total), 0) AS discount_total,
          COALESCE(SUM(taxable_total), 0) AS taxable_total,
          COALESCE(SUM(cgst), 0) AS cgst,
          COALESCE(SUM(sgst), 0) AS sgst,
          COALESCE(SUM(igst), 0) AS igst,
          COALESCE(SUM(balance), 0) AS balance
        FROM invoices
        WHERE status = 'active' AND invoice_date BETWEEN ? AND ?
      `)
      .get(start, end);

    const collected = this.db
      .prepare(`
        SELECT COALESCE(SUM(p.amount), 0) AS total
        FROM payments p JOIN invoices i ON i.id = p.invoice_id
        WHERE i.status = 'active' AND p.payment_date BETWEEN ? AND ?
      `)
      .get(start, end);

    const dailyRows = this.db
      .prepare(`
        SELECT invoice_date AS date, COALESCE(SUM(total), 0) AS total, COUNT(*) AS count
        FROM invoices
        WHERE status = 'active' AND invoice_date BETWEEN ? AND ?
        GROUP BY invoice_date
      `)
      .all(start, end);
    const dailyMap = new Map(dailyRows.map((row) => [row.date, row]));
    const daily = chunkDateSeries(start, end).map((date) => ({
      date,
      total: round2(dailyMap.get(date)?.total ?? 0),
      count: Number(dailyMap.get(date)?.count ?? 0)
    }));

    const topProducts = this.db
      .prepare(`
        SELECT ii.name, ii.sku,
          COALESCE(SUM(ii.qty * CASE WHEN ii.unit = 'sqft' THEN 1 ELSE ii.sqft_per_box END), 0) AS area_sqft,
          COALESCE(SUM(ii.line_total), 0) AS revenue
        FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
        WHERE i.status = 'active' AND i.invoice_date BETWEEN ? AND ?
        GROUP BY ii.name, ii.sku
        ORDER BY revenue DESC
        LIMIT 10
      `)
      .all(start, end)
      .map((row) => ({
        name: row.name,
        sku: row.sku ?? '',
        areaSqft: round2(row.area_sqft),
        revenue: round2(row.revenue)
      }));

    const categories = this.db
      .prepare(`
        SELECT COALESCE(p.category, 'Custom item') AS category,
          COALESCE(SUM(ii.line_total), 0) AS total
        FROM invoice_items ii
        JOIN invoices i ON i.id = ii.invoice_id
        LEFT JOIN products p ON p.id = ii.product_id
        WHERE i.status = 'active' AND i.invoice_date BETWEEN ? AND ?
        GROUP BY COALESCE(p.category, 'Custom item')
        ORDER BY total DESC
      `)
      .all(start, end)
      .map((row) => ({ category: row.category, total: round2(row.total) }));

    const payments = this.db
      .prepare(`
        SELECT p.method, COALESCE(SUM(p.amount), 0) AS total, COUNT(*) AS count
        FROM payments p JOIN invoices i ON i.id = p.invoice_id
        WHERE i.status = 'active' AND p.payment_date BETWEEN ? AND ?
        GROUP BY p.method
        ORDER BY total DESC
      `)
      .all(start, end)
      .map((row) => ({ method: row.method, total: round2(row.total), count: Number(row.count) }));

    return {
      from: start,
      to: end,
      summary: {
        invoiceCount: Number(summary.invoice_count),
        total: round2(summary.total),
        subtotal: round2(summary.subtotal),
        discountTotal: round2(summary.discount_total),
        taxableTotal: round2(summary.taxable_total),
        cgst: round2(summary.cgst),
        sgst: round2(summary.sgst),
        igst: round2(summary.igst),
        balance: round2(summary.balance),
        collected: round2(collected.total),
        averageBill: summary.invoice_count ? round2(summary.total / summary.invoice_count) : 0
      },
      daily,
      topProducts,
      categories,
      payments
    };
  }

  reportGst({ from, to } = {}) {
    const start = assertDate(from, 'From date');
    const end = assertDate(to, 'To date');
    if (start > end) throw new Error('The start date must be before the end date.');

    const totals = this.db
      .prepare(`
        SELECT
          COUNT(DISTINCT i.id) AS invoice_count,
          COALESCE(SUM(ii.taxable), 0) AS taxable,
          COALESCE(SUM(ii.cgst), 0) AS cgst,
          COALESCE(SUM(ii.sgst), 0) AS sgst,
          COALESCE(SUM(ii.igst), 0) AS igst,
          COALESCE(SUM(ii.line_total), 0) AS total
        FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
        WHERE i.status = 'active' AND i.invoice_date BETWEEN ? AND ?
      `)
      .get(start, end);

    const rates = this.db
      .prepare(`
        SELECT ii.gst_rate,
          COALESCE(SUM(ii.taxable), 0) AS taxable,
          COALESCE(SUM(ii.cgst), 0) AS cgst,
          COALESCE(SUM(ii.sgst), 0) AS sgst,
          COALESCE(SUM(ii.igst), 0) AS igst,
          COALESCE(SUM(ii.line_total), 0) AS total
        FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
        WHERE i.status = 'active' AND i.invoice_date BETWEEN ? AND ?
        GROUP BY ii.gst_rate
        ORDER BY ii.gst_rate
      `)
      .all(start, end)
      .map((row) => ({
        gstRate: round2(row.gst_rate),
        taxable: round2(row.taxable),
        cgst: round2(row.cgst),
        sgst: round2(row.sgst),
        igst: round2(row.igst),
        total: round2(row.total)
      }));

    const hsn = this.db
      .prepare(`
        SELECT ii.hsn, ii.gst_rate,
          COALESCE(SUM(ii.taxable), 0) AS taxable,
          COALESCE(SUM(ii.cgst), 0) AS cgst,
          COALESCE(SUM(ii.sgst), 0) AS sgst,
          COALESCE(SUM(ii.igst), 0) AS igst,
          COALESCE(SUM(ii.line_total), 0) AS total
        FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
        WHERE i.status = 'active' AND i.invoice_date BETWEEN ? AND ?
        GROUP BY ii.hsn, ii.gst_rate
        ORDER BY ii.hsn
      `)
      .all(start, end)
      .map((row) => ({
        hsn: row.hsn || '—',
        gstRate: round2(row.gst_rate),
        taxable: round2(row.taxable),
        cgst: round2(row.cgst),
        sgst: round2(row.sgst),
        igst: round2(row.igst),
        total: round2(row.total)
      }));

    const segments = { b2b: null, b2c: null };
    for (const row of this.db
      .prepare(`
        SELECT CASE WHEN TRIM(i.customer_gstin) <> '' THEN 'b2b' ELSE 'b2c' END AS segment,
          COUNT(DISTINCT i.id) AS invoices,
          COALESCE(SUM(ii.taxable), 0) AS taxable,
          COALESCE(SUM(ii.cgst), 0) AS cgst,
          COALESCE(SUM(ii.sgst), 0) AS sgst,
          COALESCE(SUM(ii.igst), 0) AS igst,
          COALESCE(SUM(ii.line_total), 0) AS total
        FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
        WHERE i.status = 'active' AND i.invoice_date BETWEEN ? AND ?
        GROUP BY segment
      `)
      .all(start, end)) {
      segments[row.segment] = {
        invoices: Number(row.invoices),
        taxable: round2(row.taxable),
        cgst: round2(row.cgst),
        sgst: round2(row.sgst),
        igst: round2(row.igst),
        total: round2(row.total)
      };
    }
    const blankSegment = { invoices: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
    segments.b2b ??= blankSegment;
    segments.b2c ??= blankSegment;

    return {
      from: start,
      to: end,
      totals: {
        invoiceCount: Number(totals.invoice_count),
        taxable: round2(totals.taxable),
        cgst: round2(totals.cgst),
        sgst: round2(totals.sgst),
        igst: round2(totals.igst),
        total: round2(totals.total)
      },
      rates,
      hsn,
      segments
    };
  }

  reportOutstanding({ asOf } = {}) {
    const date = assertDate(asOf || todayISO(), 'As-of date');
    const rows = this.db
      .prepare(`
        SELECT i.*, (
          SELECT COUNT(*) FROM invoice_items ii WHERE ii.invoice_id = i.id
        ) AS item_count
        FROM invoices i
        WHERE i.status = 'active' AND i.balance > 0.004 AND i.invoice_date <= ?
        ORDER BY i.invoice_date ASC, i.id ASC
      `)
      .all(date)
      .map((row) => {
        const invoice = mapInvoice(row);
        return { ...invoice, daysOutstanding: daysBetween(invoice.invoiceDate, date) };
      });

    const buckets = [
      { label: '0–30 days', min: 0, max: 30, amount: 0, count: 0 },
      { label: '31–60 days', min: 31, max: 60, amount: 0, count: 0 },
      { label: '61–90 days', min: 61, max: 90, amount: 0, count: 0 },
      { label: 'Over 90 days', min: 91, max: Infinity, amount: 0, count: 0 }
    ];

    for (const row of rows) {
      const bucket = buckets.find((entry) => row.daysOutstanding >= entry.min && row.daysOutstanding <= entry.max);
      if (bucket) {
        bucket.amount = round2(bucket.amount + row.balance);
        bucket.count += 1;
      }
    }

    return {
      asOf: date,
      totalOutstanding: round2(rows.reduce((sum, row) => sum + row.balance, 0)),
      invoiceCount: rows.length,
      customerCount: new Set(rows.map((row) => row.customerId ?? row.customerName)).size,
      buckets,
      rows
    };
  }

  reportStock({ lowOnly = false } = {}) {
    const products = this.listProducts({ lowStock: Boolean(lowOnly) });
    const totals = products.reduce(
      (accumulator, product) => ({
        boxes: accumulator.boxes + product.stockBoxes,
        area: accumulator.area + product.stockSqft,
        costValue: accumulator.costValue + product.stockValueCost,
        retailValue: accumulator.retailValue + product.stockValueRetail
      }),
      { boxes: 0, area: 0, costValue: 0, retailValue: 0 }
    );

    return {
      products,
      totals: {
        skuCount: products.length,
        lowStockCount: products.filter((product) => product.isLowStock).length,
        boxes: round3(totals.boxes),
        areaSqft: round2(totals.area),
        costValue: round2(totals.costValue),
        retailValue: round2(totals.retailValue)
      }
    };
  }

  getNextInvoicePreview() {
    const settings = this.getSettings();
    const sequence = this.db.prepare("SELECT next_value FROM sequences WHERE name = 'invoice'").get();
    const next = Number(sequence?.next_value ?? 1);
    return `${settings.invoicePrefix}-${String(next).padStart(4, '0')}`;
  }

  getDatabaseSummary() {
    const counts = this.db
      .prepare(`
        SELECT
          (SELECT COUNT(*) FROM products WHERE active = 1) AS products,
          (SELECT COUNT(*) FROM customers WHERE active = 1) AS customers,
          (SELECT COUNT(*) FROM invoices) AS invoices,
          (SELECT COUNT(*) FROM payments) AS payments
      `)
      .get();
    return {
      products: Number(counts.products),
      customers: Number(counts.customers),
      invoices: Number(counts.invoices),
      payments: Number(counts.payments),
      nextInvoiceNumber: this.getNextInvoicePreview(),
      localDate: todayISO(),
      localDateLong: new Date().toLocaleDateString('en-IN', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      })
    };
  }
}
