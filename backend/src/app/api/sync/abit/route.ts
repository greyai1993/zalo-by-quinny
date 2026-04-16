/**
 * /api/sync/abit — Abit order sync + Loyalty points credit
 *
 * POST: Create Abit invoice when Mini App order is placed
 * GET: Cron job (every 15 minutes) -- schedule: *\/15 * * * * — Pull completed Abit orders → Credit loyalty points
 *
 * Loyalty Credit Rules:
 *   - amount / 10,000 = points earned (10,000 VNĐ = 1 điểm)
 *   - Filter: status = "TC" (thành công), channel = TIKTOK_SHOP | SHOPEE
 *   - Match customer via phone number
 *   - Bonus: first order +50 điểm, birthday +100 điểm
 *   - Dedup: check abit_invoice_no trong points_ledger
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { pushOrderToAbit, MiniAppOrder } from '@/lib/abit-sync';

// ─── Loyalty Config ───────────────────────────────────────────────────────────

const POINTS_PER_VND = 10000;    // 10,000 VNĐ = 1 điểm
const FIRST_ORDER_BONUS = 50;    // Đơn đầu tiên
const BIRTHDAY_BONUS = 100;      // Birthday bonus

// ─── Tier calculation ─────────────────────────────────────────────────────────

function calculateTier(points: number): string {
  if (points >= 3000) return 'kim_cuong';
  if (points >= 1500) return 'vang';
  if (points >= 500)  return 'bac';
  return 'dong';
}

// ─── Sync endpoint auth ─────────────────────────────────────────────────────

function validateSyncSecret(req: NextRequest): NextResponse | null {
  const requiredSecret = process.env.SYNC_SECRET_KEY;
  if (!requiredSecret) return null;

  const syncSecret = req.headers.get('x-sync-secret');
  if (syncSecret !== requiredSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}

// ─── GET: Cron job — Pull Abit completed orders → Credit points ───────────────

export async function GET(req: NextRequest) {
  const unauthorized = validateSyncSecret(req);
  if (unauthorized) return unauthorized;

  const startedAt = Date.now();
  const results = {
    synced: 0,
    points_credited: 0,
    duplicates_skipped: 0,
    errors: 0,
    details: [] as string[],
  };

  try {
    // Vercel cron auth (optional but recommended)
    const authHeader = req.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Pull last 2 hours of Abit orders using a sliding window
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    // Format datetime strings for Abit API (YYYY-MM-DD HH:MM:SS)
    const formatAbitDate = (d: Date): string => {
      const pad = (n: number) => n.toString().padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };

    const startDate = formatAbitDate(twoHoursAgo);
    const endDate = formatAbitDate(now);

    const abitOrders = await pullCompletedAbitOrders(startDate, endDate);

    for (const order of abitOrders) {
      try {
        const invoiceNo = order.invoice_no ?? order.invoiceno ?? '';
        if (!invoiceNo) continue;

        // Dedup: check if already credited
        const { data: existing } = await supabaseAdmin
          .from('loyalty_points')
          .select('id')
          .eq('abit_invoice_no', invoiceNo)
          .single();

        if (existing) {
          results.duplicates_skipped++;
          continue;
        }

        // Match customer via phone
        const phone = normalizePhone(order.customerphone ?? order.customer_phone ?? '');
        if (!phone) continue;

        const { data: customer } = await supabaseAdmin
          .from('customers')
          .select('id, total_points, order_count, birthday')
          .eq('phone', phone)
          .single();

        if (!customer) continue;

        // Calculate points: amount / 10,000 = points
        const amount = parseFloat(String(order.totalamount ?? order.total_amount ?? 0));
        let points = Math.floor(amount / POINTS_PER_VND);
        if (points <= 0) continue;

        // Bonus: first order
        const bonuses: string[] = [];
        if (customer.order_count === 0) {
          points += FIRST_ORDER_BONUS;
          bonuses.push(`+${FIRST_ORDER_BONUS} đơn đầu`);
        }

        // Bonus: birthday (check if today is birthday month/day)
        if (customer.birthday) {
          const today = new Date();
          const bday = new Date(customer.birthday as string);
          if (today.getMonth() === bday.getMonth() && today.getDate() === bday.getDate()) {
            points += BIRTHDAY_BONUS;
            bonuses.push(`+${BIRTHDAY_BONUS} sinh nhật`);
          }
        }

        // Credit points
        const noteBonus = bonuses.length > 0 ? ` (${bonuses.join(', ')})` : '';
        const { error: ledgerErr } = await supabaseAdmin
          .from('loyalty_points')
          .insert({
            customer_id: customer.id,
            points,
            action: 'earn_purchase',
            reference_id: invoiceNo,
            abit_invoice_no: invoiceNo,
            note: `Đơn Abit #${invoiceNo} — ${new Intl.NumberFormat('vi-VN').format(amount)}đ${noteBonus}`,
          });

        if (ledgerErr) {
          results.errors++;
          console.error('[sync/abit] ledger error:', ledgerErr);
          continue;
        }

        // Update customer stats
        const newTotal = (customer.total_points ?? 0) + points;
        const newTier = calculateTier(newTotal);

        await supabaseAdmin
          .from('customers')
          .update({
            total_points: newTotal,
            tier: newTier,
            order_count: (customer.order_count ?? 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', customer.id);

        results.synced++;
        results.points_credited += points;
        results.details.push(`${invoiceNo}: +${points} điểm → ${phone}`);
      } catch (orderErr) {
        results.errors++;
        console.error('[sync/abit] order processing error:', orderErr);
      }
    }

    // Log cron run
    void supabaseAdmin.from('sync_logs').insert({
      type: 'abit_loyalty_cron',
      status: 'success',
      data_json: {
        ...results,
        duration_ms: Date.now() - startedAt,
        orders_checked: abitOrders.length,
      },
    });

    return NextResponse.json({
      success: true,
      ...results,
      duration_ms: Date.now() - startedAt,
    });
  } catch (err) {
    console.error('[sync/abit] GET cron error:', err);
    void supabaseAdmin.from('sync_logs').insert({
      type: 'abit_loyalty_cron',
      status: 'failed',
      data_json: { error: String(err) },
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── POST: Create Abit invoice when Mini App order is placed ─────────────────

export async function POST(req: NextRequest) {
  const unauthorized = validateSyncSecret(req);
  if (unauthorized) return unauthorized;

  try {
    const { order_id } = await req.json() as { order_id: string };

    if (!order_id) {
      return NextResponse.json({ error: 'order_id is required' }, { status: 400 });
    }

    // Fetch full order
    const { data: order, error: orderErr } = await supabaseAdmin
      .from('orders')
      .select(
        `id, order_no, customer_id, items_json,
         subtotal, discount, shipping_fee, total,
         payment_method, shipping_address, note,
         abit_invoice_no, created_at`
      )
      .eq('id', order_id)
      .single();

    if (orderErr || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // Skip if already synced
    if (order.abit_invoice_no) {
      return NextResponse.json({
        success: true,
        already_synced: true,
        abit_invoice_no: order.abit_invoice_no,
      });
    }

    // Fetch customer info
    const { data: customer } = await supabaseAdmin
      .from('customers')
      .select('name, phone')
      .eq('id', order.customer_id)
      .single();

    // Push to Abit
    const result = await pushOrderToAbit(
      order as MiniAppOrder,
      customer?.name ?? 'Khách hàng',
      customer?.phone ?? ''
    );

    // Update order with abit_invoice_no if successful
    if (result.success && result.abit_invoice_no) {
      await supabaseAdmin
        .from('orders')
        .update({
          abit_invoice_no: result.abit_invoice_no,
          updated_at: new Date().toISOString(),
        })
        .eq('id', order_id);
    }

    // Log sync attempt
    void supabaseAdmin.from('sync_logs').insert({
      type: 'abit_order_push',
      reference_id: order_id,
      status: result.success ? 'success' : 'failed',
      data_json: {
        order_no: order.order_no,
        abit_invoice_no: result.abit_invoice_no,
        error: result.error,
      },
    });

    return NextResponse.json({
      success: result.success,
      order_id,
      abit_invoice_no: result.abit_invoice_no,
      error: result.error,
    }, { status: result.success ? 200 : 502 });
  } catch (err) {
    console.error('[sync/abit] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/[\s\-\.]/g, '');
  if (cleaned.startsWith('+84')) return '0' + cleaned.slice(3);
  if (cleaned.startsWith('84') && cleaned.length === 11) return '0' + cleaned.slice(2);
  return cleaned;
}

interface AbitOrder {
  invoice_no?: string;
  invoiceno?: string;
  customerphone?: string;
  customer_phone?: string;
  totalamount?: string | number;
  total_amount?: string | number;
  invoicestatus?: string;
  channel?: string;
  ecommerce_name?: string;
}

/**
 * Pull completed orders from Abit using a sliding window (last 2 hours)
 * with pagination to ensure no orders are missed.
 *
 * @param startDate - ISO datetime string for window start (e.g. "2026-03-10 14:00:00")
 * @param endDate   - ISO datetime string for window end (e.g. "2026-03-10 16:00:00")
 */
async function pullCompletedAbitOrders(startDate: string, endDate: string): Promise<AbitOrder[]> {
  const ABIT_BASE_URL = 'https://new.abitstore.vn';
  const ACCESS_TOKEN = process.env.ABIT_ACCESS_TOKEN ?? '';
  const PARTNER_NAME = process.env.ABIT_PARTNER_NAME ?? 'Quinny';

  if (!ACCESS_TOKEN) {
    console.warn('[AbitSync] ABIT_ACCESS_TOKEN not set');
    return [];
  }

  const PAGE_LIMIT = 50;
  const allOrders: AbitOrder[] = [];
  let page = 0;

  try {
    // Paginate until response returns fewer rows than the page limit
    while (true) {
      const response = await fetch(`${ABIT_BASE_URL}/invoices/getlistInvoicebyPartner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: ACCESS_TOKEN,
          partner_name: PARTNER_NAME,
          invoicestatus: ['TC'],  // TC = Thành Công
          ecommerce_id: '',
          productstoreid: 0,
          filter_by: 'CREATE',
          order_by: 'DESC',
          date_time_start: startDate,
          date_time_end: endDate,
          page,
          limit: PAGE_LIMIT,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) throw new Error(`Abit API HTTP ${response.status}`);

      const result = await response.json() as { data?: AbitOrder[] };
      const pageOrders = result.data ?? [];

      allOrders.push(...pageOrders);

      // Stop when we get fewer rows than the page size (last page)
      if (pageOrders.length < PAGE_LIMIT) break;

      page++;
    }
  } catch (err) {
    console.error('[AbitSync] pullCompletedAbitOrders error:', err);
    return allOrders; // return whatever we managed to fetch before error
  }

  // Filter: TIKTOK_SHOP hoặc SHOPEE only
  return allOrders.filter((o) => {
    const channel = (o.channel ?? o.ecommerce_name ?? '').toUpperCase();
    return channel.includes('TIKTOK') || channel.includes('SHOPEE');
  });
}
