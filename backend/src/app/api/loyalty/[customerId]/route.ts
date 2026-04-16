/**
 * GET /api/loyalty/[customerId] — Points balance + tier info + recent transactions
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

type Params = { params: Promise<{ customerId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { customerId } = await params;

    // Fetch customer loyalty data
    const { data: customer, error: custErr } = await supabaseAdmin
      .from('customers')
      .select('id, name, tier, total_points, total_spent, order_count')
      .eq('id', customerId)
      .single();

    if (custErr) {
      if (custErr.code === 'PGRST116') {
        return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
      }
      return NextResponse.json({ error: custErr.message }, { status: 500 });
    }

    // Fetch recent transactions
    const { data: transactions } = await supabaseAdmin
      .from('loyalty_points')
      .select('id, points, action, note, reference_id, created_at')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(20);

    // Calculate points expiring soon (within 30 days)
    const expiryThreshold = new Date();
    expiryThreshold.setDate(expiryThreshold.getDate() + 30);

    const { data: expiring } = await supabaseAdmin
      .from('loyalty_points')
      .select('points, expires_at')
      .eq('customer_id', customerId)
      .gt('points', 0)
      .not('expires_at', 'is', null)
      .lt('expires_at', expiryThreshold.toISOString());

    const expiringPoints = (expiring ?? []).reduce(
      (sum, t) => sum + (t.points ?? 0), 0
    );

    // Tier config — theo spec: dong/bac/vang/kim_cuong
    const TIERS = [
      { name: 'dong',      label: 'Đồng',       minPoints: 0,    benefit: 'Tích điểm x1' },
      { name: 'bac',       label: 'Bạc',        minPoints: 500,  benefit: 'Tích điểm x1.2 + giảm phí ship 20%' },
      { name: 'vang',      label: 'Vàng',       minPoints: 1500, benefit: 'Tích điểm x1.5 + free ship + quà sinh nhật' },
      { name: 'kim_cuong', label: 'Kim Cương',  minPoints: 3000, benefit: 'Tích điểm x2 + ưu tiên xử lý + early access sale' },
    ];

    const currentTierConfig = TIERS.find((t) => t.name === customer.tier) ?? TIERS[0];
    const nextTierConfig = TIERS.find((t) => t.minPoints > (currentTierConfig.minPoints));

    return NextResponse.json({
      customer_id: customer.id,
      name: customer.name,
      total_points: customer.total_points,
      expiring_points: expiringPoints,
      total_spent: customer.total_spent,
      order_count: customer.order_count,

      tier: {
        current: currentTierConfig,
        next: nextTierConfig ?? null,
        points_to_next: nextTierConfig
          ? Math.max(0, nextTierConfig.minPoints - customer.total_points)
          : 0,
        progress_percent: nextTierConfig
          ? Math.min(100, Math.floor(
              ((customer.total_points - currentTierConfig.minPoints)
               / (nextTierConfig.minPoints - currentTierConfig.minPoints)) * 100
            ))
          : 100,
      },

      // Redemption value: 1 point = 1,000đ
      points_value_vnd: customer.total_points * 1000,

      transactions: transactions ?? [],
    });
  } catch (err) {
    console.error('[loyalty/:customerId] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
