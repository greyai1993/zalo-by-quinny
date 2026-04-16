/**
 * POST /api/loyalty/earn — Manually credit loyalty points (admin use)
 * Used for: manual adjustments, referral bonuses, event points, etc.
 *
 * Body: { customer_id, points, action, note?, reference_id? }
 * Normal earn from orders happens automatically in /api/orders/[id] PUT (status=delivered)
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const VALID_ACTIONS = ['earn', 'bonus', 'referral', 'event', 'manual_adjust', 'admin_credit'];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { customer_id, points, action = 'manual_adjust', note, reference_id } = body as {
      customer_id: string;
      points: number;
      action?: string;
      note?: string;
      reference_id?: string;
    };

    // Validation
    if (!customer_id) {
      return NextResponse.json({ error: 'customer_id is required' }, { status: 400 });
    }
    if (typeof points !== 'number' || points === 0) {
      return NextResponse.json({ error: 'points must be a non-zero number' }, { status: 400 });
    }
    if (!VALID_ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` },
        { status: 400 }
      );
    }

    // Verify customer exists
    const { data: customer, error: custErr } = await supabaseAdmin
      .from('customers')
      .select('id, name, total_points')
      .eq('id', customer_id)
      .single();

    if (custErr || !customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    // Check if deduction would go negative
    if (points < 0 && customer.total_points + points < 0) {
      return NextResponse.json(
        { error: `Insufficient points. Customer has ${customer.total_points} points` },
        { status: 400 }
      );
    }

    // Insert loyalty ledger entry
    const { data: entry, error: insertErr } = await supabaseAdmin
      .from('loyalty_points')
      .insert({
        customer_id,
        points,
        action,
        reference_id: reference_id || null,
        note: note || null,
      })
      .select('id, points, action, note, created_at')
      .single();

    if (insertErr) {
      console.error('[loyalty/earn] insert error:', insertErr);
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    // Update customer total_points
    const newTotal = customer.total_points + points;
    const newTier = calculateTier(newTotal);

    await supabaseAdmin
      .from('customers')
      .update({
        total_points: newTotal,
        tier: newTier,
        updated_at: new Date().toISOString(),
      })
      .eq('id', customer_id);

    return NextResponse.json({
      success: true,
      entry,
      customer: {
        id: customer_id,
        name: customer.name,
        total_points: newTotal,
        tier: newTier,
      },
    }, { status: 201 });
  } catch (err) {
    console.error('[loyalty/earn] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── Tier calculation ─────────────────────────────────────────────────────────
// Tier names theo task spec: dong/bac/vang/kim_cuong
// (sync với frontend + migrations)

function calculateTier(points: number): string {
  if (points >= 3000) return 'kim_cuong';
  if (points >= 1500) return 'vang';
  if (points >= 500)  return 'bac';
  return 'dong';
}
