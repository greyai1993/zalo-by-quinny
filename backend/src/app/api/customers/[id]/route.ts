/**
 * GET /api/customers/[id]  — Customer profile + order history + loyalty summary
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const includeOrders = req.nextUrl.searchParams.get('include_orders') !== 'false';
    const ordersLimit = Math.min(50, parseInt(req.nextUrl.searchParams.get('orders_limit') || '10'));

    // Fetch customer profile
    const { data: customer, error: custErr } = await supabaseAdmin
      .from('customers')
      .select(
        `id, zalo_user_id, phone, name, avatar_url,
         tier, total_points, total_spent, order_count,
         is_active, created_at, updated_at`
      )
      .eq('id', id)
      .single();

    if (custErr) {
      if (custErr.code === 'PGRST116') {
        return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
      }
      console.error('[customers/:id] GET supabase error:', custErr);
      return NextResponse.json({ error: custErr.message }, { status: 500 });
    }

    // Loyalty tier thresholds
    const tierInfo = getTierInfo(customer.tier, customer.total_points);

    let recentOrders = null;
    if (includeOrders) {
      const { data: orders } = await supabaseAdmin
        .from('orders')
        .select(
          `id, order_no, status, payment_method, total,
           items_json, created_at`
        )
        .eq('customer_id', id)
        .order('created_at', { ascending: false })
        .limit(ordersLimit);

      recentOrders = orders ?? [];
    }

    // Recent loyalty transactions
    const { data: pointsHistory } = await supabaseAdmin
      .from('loyalty_points')
      .select('id, points, action, note, created_at')
      .eq('customer_id', id)
      .order('created_at', { ascending: false })
      .limit(10);

    return NextResponse.json({
      ...customer,
      tier_info: tierInfo,
      recent_orders: recentOrders,
      points_history: pointsHistory ?? [],
    });
  } catch (err) {
    console.error('[customers/:id] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── Tier calculation ─────────────────────────────────────────────────────────

function getTierInfo(currentTier: string, totalPoints: number) {
  const tiers = [
    { name: 'bronze',  label: 'Đồng',   minPoints: 0,    nextMin: 500,  color: '#CD7F32' },
    { name: 'silver',  label: 'Bạc',    minPoints: 500,  nextMin: 1500, color: '#C0C0C0' },
    { name: 'gold',    label: 'Vàng',   minPoints: 1500, nextMin: 3000, color: '#FFD700' },
    { name: 'vip',     label: 'VIP',    minPoints: 3000, nextMin: null, color: '#8B6535' },
  ];

  const current = tiers.find((t) => t.name === currentTier) ?? tiers[0];
  const next = tiers.find((t) => t.minPoints > (current.minPoints));

  return {
    current_tier: current,
    next_tier: next ?? null,
    points_to_next: next ? Math.max(0, next.minPoints - totalPoints) : 0,
    progress_percent: next
      ? Math.min(100, Math.floor(
          ((totalPoints - current.minPoints) / (next.minPoints - current.minPoints)) * 100
        ))
      : 100,
  };
}
