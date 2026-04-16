/**
 * GET  /api/customers        — List customers with loyalty info
 * (POST handled by /api/auth/zalo-login)
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')));
    const search = searchParams.get('search');
    const tier = searchParams.get('tier');

    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('customers')
      .select(
        `id, zalo_user_id, phone, name, avatar_url,
         tier, total_points, total_spent, order_count,
         is_active, created_at, updated_at`,
        { count: 'exact' }
      )
      .eq('is_active', true)
      .range(offset, offset + limit - 1)
      .order('total_spent', { ascending: false });

    if (search) {
      query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
    }

    if (tier) {
      query = query.eq('tier', tier);
    }

    const { data, error, count } = await query;

    if (error) {
      console.error('[customers] GET supabase error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      customers: data ?? [],
      pagination: {
        page, limit,
        total: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / limit),
        hasMore: (data?.length ?? 0) === limit,
      },
    });
  } catch (err) {
    console.error('[customers] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
