/**
 * GET /api/vouchers/my?customerId=xxx — List vouchers của customer
 *
 * Returns: active vouchers + recently used vouchers
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get('customerId');

    if (!customerId) {
      return NextResponse.json({ error: 'customerId is required' }, { status: 400 });
    }

    const now = new Date().toISOString();

    // Active vouchers (chưa dùng, chưa hết hạn)
    const { data: active, error: activeErr } = await supabaseAdmin
      .from('vouchers')
      .select('id, code, discount_amount, min_order, is_used, expires_at, created_at')
      .eq('customer_id', customerId)
      .eq('is_used', false)
      .gt('expires_at', now)
      .order('created_at', { ascending: false });

    if (activeErr) {
      return NextResponse.json({ error: activeErr.message }, { status: 500 });
    }

    // Used/expired vouchers (last 10)
    const { data: history } = await supabaseAdmin
      .from('vouchers')
      .select('id, code, discount_amount, min_order, is_used, used_at, expires_at, created_at')
      .eq('customer_id', customerId)
      .or(`is_used.eq.true,expires_at.lt.${now}`)
      .order('created_at', { ascending: false })
      .limit(10);

    return NextResponse.json({
      active: active ?? [],
      history: history ?? [],
      total_active: (active ?? []).length,
    });
  } catch (err) {
    console.error('[vouchers/my] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
