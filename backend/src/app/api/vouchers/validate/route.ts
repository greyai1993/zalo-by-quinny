/**
 * POST /api/vouchers/validate — Kiểm tra voucher khi checkout
 *
 * Body: { code, order_amount }
 * Returns: { valid, discount_amount } hoặc { error }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { code?: string; order_amount?: number };
    const { code, order_amount } = body;

    if (!code) {
      return NextResponse.json({ error: 'code is required' }, { status: 400 });
    }
    if (typeof order_amount !== 'number') {
      return NextResponse.json({ error: 'order_amount is required' }, { status: 400 });
    }

    // Tìm voucher
    const { data: voucher, error: vErr } = await supabaseAdmin
      .from('vouchers')
      .select('id, code, customer_id, discount_amount, min_order, is_used, expires_at')
      .eq('code', code.toUpperCase().trim())
      .single();

    if (vErr || !voucher) {
      return NextResponse.json({
        valid: false,
        error: 'Mã voucher không tồn tại',
      }, { status: 200 });
    }

    // Check đã dùng chưa
    if (voucher.is_used) {
      return NextResponse.json({
        valid: false,
        error: 'Voucher này đã được sử dụng',
      }, { status: 200 });
    }

    // Check hết hạn
    if (new Date(voucher.expires_at) < new Date()) {
      return NextResponse.json({
        valid: false,
        error: 'Voucher đã hết hạn',
      }, { status: 200 });
    }

    // Check đơn hàng tối thiểu
    if (order_amount < voucher.min_order) {
      return NextResponse.json({
        valid: false,
        error: `Đơn hàng tối thiểu ${new Intl.NumberFormat('vi-VN').format(voucher.min_order)}đ để dùng voucher này`,
        min_order: voucher.min_order,
      }, { status: 200 });
    }

    return NextResponse.json({
      valid: true,
      code: voucher.code,
      discount_amount: voucher.discount_amount,
      min_order: voucher.min_order,
      expires_at: voucher.expires_at,
      customer_id: voucher.customer_id,
    });
  } catch (err) {
    console.error('[vouchers/validate] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
