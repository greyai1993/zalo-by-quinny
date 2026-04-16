/**
 * abit-sync.ts — Abit sync client for Mini App backend
 *
 * Reuses pattern from internal-app/src/lib/abit.ts but adapted for:
 *   1. Pushing new Mini App orders TO Abit
 *   2. Pulling inventory from Abit into Supabase
 *
 * Abit API base: https://new.abitstore.vn
 */

// ─── Config ───────────────────────────────────────────────────────────────────

const ABIT_BASE_URL = 'https://new.abitstore.vn';
const ACCESS_TOKEN = process.env.ABIT_ACCESS_TOKEN ?? '';
const PARTNER_NAME = process.env.ABIT_PARTNER_NAME ?? 'Quinny';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MiniAppOrderItem {
  product_id: string;
  variant_id?: string;
  product_name: string;
  variant_name?: string;
  sku?: string;
  qty: number;
  unit_price: number;
  total_price: number;
}

export interface MiniAppOrder {
  id: string;
  order_no: string;
  customer_id: string;
  items_json: MiniAppOrderItem[];
  subtotal: number;
  discount: number;
  shipping_fee: number;
  total: number;
  payment_method: string;
  shipping_address: {
    name: string;
    phone: string;
    address: string;
    district?: string;
    city: string;
  };
  note?: string;
  created_at: string;
}

export interface AbitInvoicePayload {
  access_token: string;
  partner_name: string;
  invoice_no: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  items: Array<{
    product_code: string;
    product_name: string;
    quantity: number;
    unit_price: number;
    total: number;
  }>;
  total_amount: number;
  discount: number;
  shipping_fee: number;
  payment_method: string;
  note: string;
  channel: string;
  order_date: string;
}

export interface AbitProduct {
  productid: number;
  productcode: string;
  productName: string;
  price: string;
  unit: string;
  stock_qty?: number;
}

export interface AbitSyncResult {
  success: boolean;
  abit_invoice_no?: string;
  error?: string;
}

// ─── Order → Abit invoice mapper ─────────────────────────────────────────────

export function mapOrderToAbitInvoice(
  order: MiniAppOrder,
  customerName: string,
  customerPhone: string
): AbitInvoicePayload {
  const paymentLabel = {
    cod: 'COD',
    zalopay: 'ZaloPay',
    momo: 'Momo',
    transfer: 'Chuyển khoản',
    loyalty_points: 'Điểm thưởng',
  }[order.payment_method] ?? order.payment_method;

  return {
    access_token: ACCESS_TOKEN,
    partner_name: PARTNER_NAME,
    invoice_no: order.order_no,
    customer_name: order.shipping_address?.name || customerName,
    customer_phone: order.shipping_address?.phone || customerPhone,
    customer_address: [
      order.shipping_address?.address,
      order.shipping_address?.district,
      order.shipping_address?.city,
    ]
      .filter(Boolean)
      .join(', '),
    items: order.items_json.map((item) => ({
      product_code: item.sku || item.product_id,
      product_name: item.variant_name
        ? `${item.product_name} - ${item.variant_name}`
        : item.product_name,
      quantity: item.qty,
      unit_price: item.unit_price,
      total: item.total_price,
    })),
    total_amount: order.total,
    discount: order.discount,
    shipping_fee: order.shipping_fee,
    payment_method: paymentLabel,
    note: order.note || `Đơn hàng Zalo Mini App - ${order.order_no}`,
    channel: 'ZALO_MINI_APP',
    order_date: order.created_at.slice(0, 19).replace('T', ' '),
  };
}

// ─── Push order to Abit ───────────────────────────────────────────────────────

/**
 * Create an invoice in Abit from a Mini App order.
 *
 * ⚠️  NOTE: Abit does not have a public "create invoice" API endpoint confirmed.
 *     This uses the pattern from existing integration.
 *     If Abit does not support external order creation, this will fail gracefully
 *     and we fall back to manual sync via the internal app.
 *
 * Endpoint to try: POST /invoices/createInvoice (unverified — document if confirmed)
 */
export async function pushOrderToAbit(
  order: MiniAppOrder,
  customerName: string,
  customerPhone: string
): Promise<AbitSyncResult> {
  if (!ACCESS_TOKEN) {
    console.warn('[AbitSync] ABIT_ACCESS_TOKEN not set — skipping push');
    return { success: false, error: 'ABIT_ACCESS_TOKEN not configured' };
  }

  const payload = mapOrderToAbitInvoice(order, customerName, customerPhone);

  try {
    const response = await fetch(`${ABIT_BASE_URL}/invoices/createInvoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });

    const result = await response.json() as {
      success?: boolean;
      invoice_no?: string;
      error?: string;
      message?: string;
    };

    if (!response.ok || result.success === false) {
      const errMsg = result.error ?? result.message ?? `HTTP ${response.status}`;
      console.error('[AbitSync] Push failed:', errMsg, result);
      return { success: false, error: errMsg };
    }

    return {
      success: true,
      abit_invoice_no: result.invoice_no ?? order.order_no,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[AbitSync] Push error:', err);
    return { success: false, error: errMsg };
  }
}

// ─── Pull inventory from Abit ─────────────────────────────────────────────────

/**
 * Fetch product list / inventory from Abit.
 * Maps to Supabase products table.
 *
 * ⚠️  Abit GET /products endpoint: unverified.
 *     Falls back to deriving inventory from recent invoice data if direct API unavailable.
 */
export async function pullInventoryFromAbit(): Promise<AbitProduct[]> {
  if (!ACCESS_TOKEN) {
    throw new Error('ABIT_ACCESS_TOKEN not configured');
  }

  // Attempt: direct product list endpoint
  try {
    const response = await fetch(`${ABIT_BASE_URL}/products/getListProduct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: ACCESS_TOKEN,
        partner_name: PARTNER_NAME,
        page: 0,
        limit: 500,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`Abit API HTTP ${response.status}`);
    }

    const result = await response.json() as {
      total?: number;
      data?: AbitProduct[];
      error?: string;
    };

    if (result.data && Array.isArray(result.data)) {
      return result.data;
    }

    throw new Error(result.error ?? 'No data returned from Abit product API');
  } catch (err) {
    console.warn('[AbitSync] Direct product API failed:', err);
    // Return empty — caller handles fallback
    return [];
  }
}

/**
 * Derive inventory from recent Abit invoices (fallback when product API unavailable).
 * Aggregates SKU quantities from last N months of successful orders.
 */
export async function deriveInventoryFromInvoices(months = 3): Promise<Map<string, number>> {
  const skuCounts = new Map<string, number>();
  const now = new Date();

  for (let i = 0; i < months; i++) {
    const year = now.getFullYear();
    const month = now.getMonth() + 1 - i;
    const adjustedYear = month <= 0 ? year - 1 : year;
    const adjustedMonth = month <= 0 ? month + 12 : month;

    try {
      const invoices = await fetchAbitInvoices(adjustedYear, adjustedMonth);
      for (const inv of invoices) {
        const status = (inv.invoicestatus ?? '').toLowerCase();
        const isSuccess = ['thanhcong', 'daphatthanhcong', 'giaothanhcong', 'xacnhandadat'].includes(status);
        if (!isSuccess) continue;

        const products = inv.listProduct ?? [];
        if (products.length === 0) {
          // Parse mahang: "(qty)SKU-CODE"
          const parts = (inv.mahang ?? '').split(',');
          for (const part of parts) {
            const match = part.trim().match(/^\((\d+)\)(.+)$/);
            if (match) {
              const qty = parseInt(match[1]);
              const sku = match[2].trim();
              skuCounts.set(sku, (skuCounts.get(sku) ?? 0) + qty);
            }
          }
        } else {
          for (const p of products) {
            const qty = parseFloat(p.amount ?? '1') || 1;
            const code = (p.productcode ?? '').trim();
            if (code) {
              skuCounts.set(code, (skuCounts.get(code) ?? 0) + Math.round(qty));
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[AbitSync] Failed to fetch invoices for ${adjustedYear}/${adjustedMonth}:`, err);
    }
  }

  return skuCounts;
}

// ─── Internal: fetch Abit invoices ───────────────────────────────────────────

async function fetchAbitInvoices(
  year: number,
  month: number
): Promise<Array<{ invoicestatus: string; listProduct?: Array<{ productcode: string; amount: string }>; mahang: string }>> {
  const startDate = `${year}-${month.toString().padStart(2, '0')}-01 00:00:00`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${month.toString().padStart(2, '0')}-${lastDay} 23:59:59`;

  const response = await fetch(`${ABIT_BASE_URL}/invoices/getlistInvoicebyPartner`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: ACCESS_TOKEN,
      partner_name: PARTNER_NAME,
      invoicestatus: [],
      ecommerce_id: '',
      productstoreid: 0,
      filter_by: 'CREATE',
      order_by: 'DESC',
      date_time_start: startDate,
      date_time_end: endDate,
      page: 0,
      limit: 200,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) throw new Error(`Abit API HTTP ${response.status}`);
  const result = await response.json() as { data?: unknown[] };
  return (result.data ?? []) as Array<{ invoicestatus: string; listProduct?: Array<{ productcode: string; amount: string }>; mahang: string }>;
}
