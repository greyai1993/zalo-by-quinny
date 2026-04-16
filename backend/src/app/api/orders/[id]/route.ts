/**
 * GET /api/orders/[id]  — Order detail
 * PUT /api/orders/[id]  — Update order status (admin / delivery flow)
 *
 * Status flow:
 *   pending → confirmed → shipping → delivered → (cancelled)
 *
 * PUT body: { status: OrderStatus, shipper_name? }
 * ZNS auto-triggered on status change:
 *   confirmed  → Template ORDER_CONFIRMED (already sent on creation)
 *   shipping   → Template ORDER_SHIPPING
 *   delivered  → Template ORDER_DELIVERED
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, OrderStatus } from '@/lib/supabase';
import { sendZNS, ZNS_TEMPLATES } from '@/lib/zns';

type Params = { params: Promise<{ id: string }> };

const VALID_STATUSES: OrderStatus[] = [
  'pending', 'confirmed', 'shipping', 'delivered', 'cancelled',
];

// ─── GET /api/orders/:id ──────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;

    const { data, error } = await supabaseAdmin
      .from('orders')
      .select(
        `id, order_no, customer_id, zalo_user_id, items_json,
         subtotal, discount, shipping_fee, total,
         payment_method, payment_status, status,
         shipping_address, note, abit_invoice_no,
         voucher_code, loyalty_points_used, created_at, updated_at,
         customer:customers(id, name, phone, avatar_url, tier)`
      )
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 });
      }
      console.error('[orders/:id] GET supabase error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error('[orders/:id] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── PUT /api/orders/:id ──────────────────────────────────────────────────────

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = await req.json();

    const { status, payment_status, shipper_name } = body as {
      status?: OrderStatus;
      payment_status?: string;
      shipper_name?: string;
    };

    if (!status && !payment_status) {
      return NextResponse.json({ error: 'status or payment_status is required' }, { status: 400 });
    }

    if (status && !VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 }
      );
    }

    // Fetch current order for ZNS + loyalty credit
    const { data: currentOrder, error: fetchErr } = await supabaseAdmin
      .from('orders')
      .select('id, order_no, customer_id, total, status, zalo_user_id')
      .eq('id', id)
      .single();

    if (fetchErr) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (status) updates.status = status;
    if (payment_status) updates.payment_status = payment_status;

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('orders')
      .update(updates)
      .eq('id', id)
      .select('id, order_no, status, payment_status, total, updated_at')
      .single();

    if (updateErr) {
      console.error('[orders/:id] PUT supabase error:', updateErr);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // ── Post-status actions ──────────────────────────────────────────────────
    if (status && status !== currentOrder.status) {
      const { data: customer } = await supabaseAdmin
        .from('customers')
        .select('phone, name')
        .eq('id', currentOrder.customer_id)
        .single();

      const phone = customer?.phone;
      const customerName = customer?.name ?? 'Quý khách';

      // ZNS notifications based on new status
      if (phone) {
        if (status === 'shipping') {
          await sendZNS(phone, ZNS_TEMPLATES.ORDER_SHIPPING, {
            order_id: currentOrder.order_no,
            shipper_name: shipper_name || '',
          });
        } else if (status === 'delivered') {
          await sendZNS(phone, ZNS_TEMPLATES.ORDER_DELIVERED, {
            order_id: currentOrder.order_no,
            customer_name: customerName,
          });
        }
      }

      // Credit loyalty points when order is delivered
      if (status === 'delivered') {
        await creditLoyaltyOnDelivery(currentOrder.id, currentOrder.customer_id, currentOrder.total);
      }
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error('[orders/:id] PUT error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── Helper: credit loyalty points when order delivered ──────────────────────

const POINTS_PER_VND = 10000;    // 10,000 VNĐ = 1 điểm
const FIRST_ORDER_BONUS = 50;    // Đơn đầu tiên
const BIRTHDAY_BONUS = 100;      // Birthday bonus

function calculateTier(points: number): string {
  if (points >= 3000) return 'kim_cuong';
  if (points >= 1500) return 'vang';
  if (points >= 500)  return 'bac';
  return 'dong';
}

async function creditLoyaltyOnDelivery(
  orderId: string,
  customerId: string,
  total: number
): Promise<void> {
  try {
    // Rule: 1 point per 10,000đ spent
    let pointsEarned = Math.floor(total / POINTS_PER_VND);
    if (pointsEarned <= 0) return;

    // Check if already credited (idempotent)
    const { data: existing } = await supabaseAdmin
      .from('loyalty_points')
      .select('id')
      .eq('reference_id', orderId)
      .eq('action', 'earn_order')
      .single();

    if (existing) return; // already credited

    // Fetch customer data for bonus checks
    const { data: customer } = await supabaseAdmin
      .from('customers')
      .select('id, total_points, order_count, birthday')
      .eq('id', customerId)
      .single();

    if (!customer) return;

    const bonuses: string[] = [];

    // Bonus: first order (+50 pts) — check if this is customer's first order
    if ((customer.order_count ?? 0) === 0) {
      pointsEarned += FIRST_ORDER_BONUS;
      bonuses.push(`+${FIRST_ORDER_BONUS} đơn đầu tiên`);
    }

    // Bonus: birthday (+100 pts) — check if today matches customer's birthday month/day
    if (customer.birthday) {
      const today = new Date();
      const bday = new Date(customer.birthday as string);
      if (today.getMonth() === bday.getMonth() && today.getDate() === bday.getDate()) {
        pointsEarned += BIRTHDAY_BONUS;
        bonuses.push(`+${BIRTHDAY_BONUS} sinh nhật`);
      }
    }

    const noteBonus = bonuses.length > 0 ? ` (${bonuses.join(', ')})` : '';

    // Insert points ledger entry
    await supabaseAdmin.from('loyalty_points').insert({
      customer_id: customerId,
      points: pointsEarned,
      action: 'earn_order',
      reference_id: orderId,
      note: `Tích điểm từ đơn hàng${noteBonus}`,
    });

    // Update customer totals (points + tier + order_count + spent)
    const newTotal = (customer.total_points ?? 0) + pointsEarned;
    const newTier = calculateTier(newTotal);

    await supabaseAdmin
      .from('customers')
      .update({
        total_points: newTotal,
        tier: newTier,
        order_count: (customer.order_count ?? 0) + 1,
        total_spent: total,
        updated_at: new Date().toISOString(),
      })
      .eq('id', customerId);

  } catch (err) {
    console.error('[orders] creditLoyaltyOnDelivery error:', err);
    // Non-fatal — order update already succeeded
  }
}
