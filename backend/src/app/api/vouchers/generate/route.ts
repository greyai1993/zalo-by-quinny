/**
 * POST /api/vouchers/generate — Đổi điểm lấy voucher
 *
 * Loyalty Redeem Rules:
 *   - 100 điểm = 10,000 VNĐ voucher
 *   - Min redeem: 200 điểm
 *   - Voucher code format: BQ-XXXX-XXXX (uppercase)
 *   - Expiry: +30 ngày từ ngày tạo
 *   - Min order để dùng voucher: 200,000 VNĐ
 *
 * Body: { customerId, pointsToRedeem }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const POINTS_PER_VND = 10000; // 100 điểm = 10,000 VNĐ → 1 điểm = 100 VNĐ
const MIN_REDEEM_POINTS = 200;
const VOUCHER_MIN_ORDER = 200000; // 200k VNĐ
const VOUCHER_EXPIRY_DAYS = 30;

function generateVoucherCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Bỏ O, I, 0, 1 để tránh nhầm
  const rand4 = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `BQ-${rand4()}-${rand4()}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { customerId?: string; pointsToRedeem?: number };
    const { customerId, pointsToRedeem } = body;

    if (!customerId) {
      return NextResponse.json({ error: 'customerId is required' }, { status: 400 });
    }
    if (typeof pointsToRedeem !== 'number' || pointsToRedeem < MIN_REDEEM_POINTS) {
      return NextResponse.json({
        error: `Tối thiểu ${MIN_REDEEM_POINTS} điểm để đổi voucher`,
      }, { status: 400 });
    }
    if (pointsToRedeem % 100 !== 0) {
      return NextResponse.json({
        error: 'Số điểm phải là bội số của 100',
      }, { status: 400 });
    }

    // Lấy customer
    const { data: customer, error: custErr } = await supabaseAdmin
      .from('customers')
      .select('id, name, total_points')
      .eq('id', customerId)
      .single();

    if (custErr || !customer) {
      return NextResponse.json({ error: 'Khách hàng không tồn tại' }, { status: 404 });
    }

    // Kiểm tra đủ điểm
    if (customer.total_points < pointsToRedeem) {
      return NextResponse.json({
        error: `Không đủ điểm. Hiện có ${customer.total_points} điểm, cần ${pointsToRedeem} điểm`,
      }, { status: 400 });
    }

    // Tính giá trị voucher: 100 điểm = 10,000 VNĐ
    const discountAmount = Math.floor(pointsToRedeem / 100) * POINTS_PER_VND;

    // Gen voucher code (ensure unique)
    let code = generateVoucherCode();
    let attempt = 0;
    while (attempt < 5) {
      const { data: existing } = await supabaseAdmin
        .from('vouchers')
        .select('id')
        .eq('code', code)
        .single();
      if (!existing) break;
      code = generateVoucherCode();
      attempt++;
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + VOUCHER_EXPIRY_DAYS);

    // Transaction: tạo voucher + deduct points trong một batch
    const { data: voucher, error: voucherErr } = await supabaseAdmin
      .from('vouchers')
      .insert({
        code,
        customer_id: customerId,
        discount_amount: discountAmount,
        min_order: VOUCHER_MIN_ORDER,
        is_used: false,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (voucherErr) {
      console.error('[vouchers/generate] insert error:', voucherErr);
      return NextResponse.json({ error: 'Không thể tạo voucher' }, { status: 500 });
    }

    // Log points deduction
    const { error: ledgerErr } = await supabaseAdmin
      .from('loyalty_points')
      .insert({
        customer_id: customerId,
        points: -pointsToRedeem,
        action: 'redeem_voucher',
        reference_id: code,
        note: `Đổi ${pointsToRedeem} điểm lấy voucher ${code} (${new Intl.NumberFormat('vi-VN').format(discountAmount)}đ)`,
      });

    if (ledgerErr) {
      // Rollback voucher
      await supabaseAdmin.from('vouchers').delete().eq('code', code);
      return NextResponse.json({ error: 'Lỗi ghi ledger' }, { status: 500 });
    }

    // Update customer total_points + recalc tier
    const newTotal = customer.total_points - pointsToRedeem;
    const newTier = calculateTier(newTotal);

    await supabaseAdmin
      .from('customers')
      .update({
        total_points: newTotal,
        tier: newTier,
        updated_at: new Date().toISOString(),
      })
      .eq('id', customerId);

    return NextResponse.json({
      success: true,
      voucher: {
        code: voucher.code,
        discount_amount: voucher.discount_amount,
        min_order: voucher.min_order,
        expires_at: voucher.expires_at,
        is_used: false,
      },
      points_deducted: pointsToRedeem,
      points_remaining: newTotal,
    }, { status: 201 });
  } catch (err) {
    console.error('[vouchers/generate] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── Tier calculation ─────────────────────────────────────────────────────────
// Tên tier theo task spec (dong/bac/vang/kim_cuong)

function calculateTier(points: number): string {
  if (points >= 3000) return 'kim_cuong';
  if (points >= 1500) return 'vang';
  if (points >= 500)  return 'bac';
  return 'dong';
}
