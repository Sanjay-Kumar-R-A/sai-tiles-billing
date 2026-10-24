import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { BillingRepository } from '../src/repository.js';
import { addDaysISO, todayISO } from '../shared/format.js';

function fixture(t, { seed = false } = {}) {
  const db = openDatabase(':memory:', { seed });
  t.after(() => db.close());
  const repo = new BillingRepository(db);
  const product = repo.createProduct({
    name: 'Aspen Grey Matt',
    sku: 'A1',
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
    stockBoxes: 10,
    reorderLevel: 3,
    batchNo: 'B-1'
  });
  const customer = repo.createCustomer({
    name: 'Karthik Raman',
    phone: '98400 22110',
    gstin: '33ABCDE1234F1Z5',
    type: 'Contractor',
    address: '14, Lake View Colony',
    city: 'Chennai',
    state: 'Tamil Nadu',
    pincode: '600088'
  });
  return { db, repo, product, customer };
}

function createStandardInvoice(repo, customer, product, overrides = {}) {
  return repo.createInvoice({
    invoiceDate: todayISO(),
    customerId: customer.id,
    placeOfSupply: 'Tamil Nadu',
    items: [{ productId: product.id, qty: 31, unit: 'sqft', rate: 62, discountPct: 0 }],
    amountPaid: 1000,
    paymentMethod: 'Cash',
    ...overrides
  });
}

test('creates a GST invoice, deducts stock, and records payment', (t) => {
  const { repo, product, customer } = fixture(t);
  const invoice = createStandardInvoice(repo, customer, product);

  assert.equal(invoice.invoiceNo, 'INV-0001');
  assert.equal(invoice.customerName, 'Karthik Raman');
  assert.equal(invoice.placeOfSupply, 'Tamil Nadu');
  assert.equal(invoice.stateCode, '33');
  assert.equal(invoice.subtotal, 1922);
  assert.equal(invoice.cgst, 172.98);
  assert.equal(invoice.sgst, 172.98);
  assert.equal(invoice.igst, 0);
  assert.equal(invoice.roundOff, 0.04);
  assert.equal(invoice.total, 2268);
  assert.equal(invoice.amountPaid, 1000);
  assert.equal(invoice.balance, 1268);
  assert.equal(invoice.paymentStatus, 'partial');
  assert.equal(invoice.dueDate, addDaysISO(todayISO(), 15));
  assert.equal(invoice.items.length, 1);
  assert.equal(invoice.items[0].areaSqft, 31);
  assert.equal(invoice.items[0].stockBoxes, 2);
  assert.equal(invoice.payments.length, 1);
  assert.equal(invoice.payments[0].method, 'Cash');

  const updated = repo.getProduct(product.id);
  assert.equal(updated.stockBoxes, 8);

  const movements = repo.listStockMovements({ productId: product.id });
  assert.equal(movements[0].type, 'sale');
  assert.equal(movements[0].qtyBoxes, -2);
  assert.equal(movements[0].invoiceNo, 'INV-0001');
});

test('inter-state invoice uses IGST, supports part-payment, and void restores stock', (t) => {
  const { repo } = fixture(t);
  const customer = repo.createCustomer({
    name: 'Coimbatore Contractors',
    type: 'Builder',
    city: 'Bengaluru',
    state: 'Karnataka'
  });
  const product = repo.createProduct({
    name: 'Box Tile',
    sku: 'B1',
    sellUnit: 'box',
    price: 600,
    sqftPerBox: 12,
    costPerBox: 450,
    stockBoxes: 20,
    gstRate: 18
  });

  const invoice = repo.createInvoice({
    invoiceDate: todayISO(),
    customerId: customer.id,
    items: [{ productId: product.id, qty: 2, unit: 'box', rate: 600 }],
    amountPaid: 0
  });

  assert.equal(invoice.placeOfSupply, 'Karnataka');
  assert.equal(invoice.stateCode, '29');
  assert.equal(invoice.cgst, 0);
  assert.equal(invoice.sgst, 0);
  assert.equal(invoice.igst, 216);
  assert.equal(invoice.total, 1416);
  assert.equal(invoice.paymentStatus, 'unpaid');
  assert.equal(invoice.dueDate, addDaysISO(todayISO(), 15));
  assert.equal(repo.getProduct(product.id).stockBoxes, 18);

  const withPayment = repo.addPayment(invoice.id, {
    amount: 400,
    method: 'UPI',
    reference: 'UPI-123',
    paymentDate: todayISO()
  });
  assert.equal(withPayment.amountPaid, 400);
  assert.equal(withPayment.balance, 1016);
  assert.equal(withPayment.paymentStatus, 'partial');

  const payment = withPayment.payments.at(-1);
  const afterDelete = repo.deletePayment(payment.id);
  assert.equal(afterDelete.amountPaid, 0);
  assert.equal(afterDelete.balance, 1416);
  assert.equal(afterDelete.paymentStatus, 'unpaid');

  const voided = repo.voidInvoice(invoice.id, 'Customer cancelled the order');
  assert.equal(voided.status, 'void');
  assert.equal(voided.balance, 0);
  assert.equal(voided.voidReason, 'Customer cancelled the order');
  assert.equal(repo.getProduct(product.id).stockBoxes, 20);
  assert.throws(() => repo.addPayment(invoice.id, { amount: 10, method: 'Cash' }), /cancelled/i);

  const movements = repo.listStockMovements({ productId: product.id });
  assert.equal(movements[0].type, 'void');
  assert.equal(movements[0].qtyBoxes, 2);
});

test('stock-in adds stock and maintains a weighted average cost', (t) => {
  const { repo } = fixture(t);
  const product = repo.createProduct({
    name: 'Box Tile',
    sku: 'B2',
    sellUnit: 'box',
    price: 600,
    costPerBox: 450,
    stockBoxes: 20,
    gstRate: 18
  });

  repo.createStockIn({
    date: todayISO(),
    supplier: 'Gujarat Ceramics',
    notes: 'Lot 44',
    items: [{ productId: product.id, qtyBoxes: 10, costPerBox: 525 }]
  });

  const updated = repo.getProduct(product.id);
  assert.equal(updated.stockBoxes, 30);
  assert.equal(updated.costPerBox, 475);

  const movements = repo.listStockMovements({ productId: product.id });
  assert.equal(movements[0].type, 'purchase');
  assert.equal(movements[0].qtyBoxes, 10);
  assert.equal(movements[0].reference, 'Gujarat Ceramics');
});

test('reports reflect invoices, tax, collections, and outstanding balances', (t) => {
  const { repo, product, customer } = fixture(t);
  const interCustomer = repo.createCustomer({
    name: 'Bengaluru Interiors',
    state: 'Karnataka',
    type: 'Interior Designer'
  });
  const boxProduct = repo.createProduct({
    name: 'Carrara Gloss',
    sku: 'C1',
    sellUnit: 'box',
    price: 600,
    sqftPerBox: 12,
    costPerBox: 450,
    stockBoxes: 20,
    gstRate: 18
  });

  createStandardInvoice(repo, customer, product);
  repo.createInvoice({
    invoiceDate: todayISO(),
    customerId: interCustomer.id,
    items: [{ productId: boxProduct.id, qty: 2, unit: 'box', rate: 600 }],
    amountPaid: 0
  });

  const today = todayISO();
  const sales = repo.reportSales({ from: today, to: today });
  assert.equal(sales.summary.invoiceCount, 2);
  assert.equal(sales.summary.total, 3684);
  assert.equal(sales.summary.taxableTotal, 3122);
  assert.equal(sales.summary.cgst, 172.98);
  assert.equal(sales.summary.igst, 216);
  assert.equal(sales.summary.collected, 1000);
  assert.equal(sales.daily.length, 1);
  assert.equal(sales.topProducts.length, 2);

  const gst = repo.reportGst({ from: today, to: today });
  assert.equal(gst.totals.taxable, 3122);
  assert.equal(gst.totals.cgst, 172.98);
  assert.equal(gst.totals.igst, 216);
  assert.equal(gst.totals.total, 3683.96);
  assert.equal(gst.rates.length, 1);
  assert.equal(gst.hsn[0].hsn, '6907');
  assert.equal(gst.segments.b2b.invoices, 1);
  assert.equal(gst.segments.b2c.invoices, 1);

  const outstanding = repo.reportOutstanding({ asOf: today });
  assert.equal(outstanding.invoiceCount, 2);
  assert.equal(outstanding.totalOutstanding, 2684);
  assert.equal(outstanding.buckets[0].amount, 2684);

  const dashboard = repo.getDashboard();
  assert.equal(dashboard.todaySales, 3684);
  assert.equal(dashboard.todayCount, 2);
  assert.equal(dashboard.outstanding, 2684);
  assert.equal(dashboard.outstandingCount, 2);
  assert.equal(dashboard.recentInvoices.length, 2);
  assert.equal(dashboard.lowStockCount, 0);

  const stock = repo.reportStock();
  assert.equal(stock.totals.skuCount, 2);
  assert.equal(stock.totals.boxes, 26);
  assert.ok(stock.totals.retailValue > 0);
});

test('validates payments, archived products, and custom invoice lines', (t) => {
  const { repo, product, customer } = fixture(t);

  assert.throws(
    () =>
      repo.createInvoice({
        customerId: customer.id,
        items: [{ productId: product.id, qty: 1, unit: 'sqft', rate: 62 }],
        amountPaid: 100000
      }),
    /more than the invoice total/i
  );

  assert.throws(
    () =>
      repo.createInvoice({
        customerId: customer.id,
        items: [{ productId: product.id, qty: 0, unit: 'sqft', rate: 62 }]
      }),
    /Quantity/i
  );

  const custom = repo.createInvoice({
    customerId: customer.id,
    items: [{ name: 'Cutting & polishing', qty: 10, unit: 'sqft', rate: 50, gstRate: 18 }],
    amountPaid: 0
  });
  assert.equal(custom.subtotal, 500);
  assert.equal(custom.total, 590);
  assert.equal(custom.paymentStatus, 'unpaid');
  assert.equal(custom.items[0].productId, null);
  assert.equal(custom.items[0].areaSqft, 10);

  repo.setProductActive(product.id, false);
  assert.throws(
    () =>
      repo.createInvoice({
        customerId: customer.id,
        items: [{ productId: product.id, qty: 1, unit: 'sqft', rate: 62 }]
      }),
    /archived/i
  );
});

test('invoice numbering is sequential and respects prefix changes', (t) => {
  const { repo, product, customer } = fixture(t);
  const first = createStandardInvoice(repo, customer, product);
  assert.equal(first.invoiceNo, 'INV-0001');

  repo.updateSettings({ invoicePrefix: 'TL' });
  const second = repo.createInvoice({
    customerId: customer.id,
    customerName: 'Walk-in',
    placeOfSupply: 'Tamil Nadu',
    items: [{ productId: product.id, qty: 1, unit: 'box', rate: 961 }],
    amountPaid: 0
  });
  assert.equal(second.invoiceNo, 'TL-0002');
  assert.equal(repo.getNextInvoicePreview(), 'TL-0003');

  const list = repo.listInvoices({ search: 'TL-0002' });
  assert.equal(list.total, 1);
  assert.equal(list.items[0].customerName, 'Karthik Raman');
});

test('database seeds a starter catalogue when requested', (t) => {
  const db = openDatabase(':memory:', { seed: true });
  t.after(() => db.close());
  const repo = new BillingRepository(db);

  const products = repo.listProducts();
  assert.equal(products.length, 8);
  assert.ok(products.some((product) => product.isLowStock));
  const customers = repo.listCustomers();
  assert.equal(customers.length, 3);
  assert.equal(repo.listInvoices().total, 0);
  assert.equal(repo.getDashboard().todayCount, 0);
});
