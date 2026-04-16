/**
 * POST /api/auth/zalo-login
 * 
 * Authenticate Zalo user → create or update customer record
 * Called from Mini App after getting Zalo userID + token
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

interface ZaloLoginBody {
  zalo_user_id: string;
  name: string;
  avatar_url?: string;
  token: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: ZaloLoginBody = await req.json();
    const { zalo_user_id, name, avatar_url } = body;

    if (!zalo_user_id) {
      return NextResponse.json({ error: 'zalo_user_id required' }, { status: 400 });
    }

    // Upsert customer record
    const { data: customer, error } = await supabaseAdmin
      .from('customers')
      .upsert(
        {
          zalo_user_id,
          name,
          avatar_url,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'zalo_user_id',
          ignoreDuplicates: false,
        }
      )
      .select('id, zalo_user_id, phone, name, avatar_url, tier, total_points, total_spent, order_count')
      .single();

    if (error) {
      console.error('[auth/zalo-login] Supabase error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(customer);
  } catch (err) {
    console.error('[auth/zalo-login] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
