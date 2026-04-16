/**
 * POST /api/customers/update-phone
 *
 * Update customer's phone number in Supabase.
 *
 * Accepts two call patterns:
 *   1. { customerId, phone }       — direct update (from admin / internal)
 *   2. { zalo_user_id, phone_token } — from Mini App useZaloAuth hook
 *      Zalo server API is called to decode phone_token → get real phone number
 *
 * Returns: { success: true, phone }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

interface UpdatePhoneBody {
  // Pattern 1: direct update
  customerId?: string;
  phone?: string;
  // Pattern 2: Zalo token decode
  zalo_user_id?: string;
  phone_token?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as UpdatePhoneBody;

    let customerId: string | undefined = body.customerId;
    let phone: string | undefined = body.phone;

    // ── Pattern 2: decode phone from Zalo token ──────────────────────────────
    if (!phone && body.zalo_user_id && body.phone_token) {
      // Decode token via Zalo server API
      const decodedPhone = await decodeZaloPhoneToken(body.phone_token);

      if (!decodedPhone) {
        return NextResponse.json(
          { error: 'Không thể giải mã số điện thoại từ token Zalo' },
          { status: 400 }
        );
      }

      phone = normalizePhone(decodedPhone);

      // Look up customer by zalo_user_id if customerId not provided
      if (!customerId) {
        const { data: customer } = await supabaseAdmin
          .from('customers')
          .select('id')
          .eq('zalo_user_id', body.zalo_user_id)
          .single();

        if (!customer) {
          return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
        }

        customerId = customer.id;
      }
    }

    // ── Validate required fields ─────────────────────────────────────────────
    if (!customerId || !phone) {
      return NextResponse.json(
        { error: 'customerId and phone are required' },
        { status: 400 }
      );
    }

    const normalizedPhone = normalizePhone(phone);

    // ── Update customers.phone ───────────────────────────────────────────────
    const { error: updateErr } = await supabaseAdmin
      .from('customers')
      .update({
        phone: normalizedPhone,
        updated_at: new Date().toISOString(),
      })
      .eq('id', customerId);

    if (updateErr) {
      console.error('[customers/update-phone] supabase error:', updateErr);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, phone: normalizedPhone });
  } catch (err) {
    console.error('[customers/update-phone] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalize phone to Vietnamese standard format (0xxxxxxxxx)
 */
function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/[\s\-\.]/g, '');
  if (cleaned.startsWith('+84')) return '0' + cleaned.slice(3);
  if (cleaned.startsWith('84') && cleaned.length === 11) return '0' + cleaned.slice(2);
  return cleaned;
}

/**
 * Decode Zalo phone token via Zalo Server API
 * Returns the plain phone number string, or null on failure.
 *
 * Docs: https://developers.zalo.me/docs/api/open-api/tai-lieu/lay-so-dien-thoai-nguoi-dung
 * Endpoint: POST https://graph.zalo.me/v2.0/me/info
 */
async function decodeZaloPhoneToken(phoneToken: string): Promise<string | null> {
  const appSecretKey = process.env.ZALO_APP_SECRET;
  const accessToken = process.env.ZALO_OA_ACCESS_TOKEN;

  if (!appSecretKey || !accessToken) {
    console.warn('[customers/update-phone] ZALO_APP_SECRET or ZALO_OA_ACCESS_TOKEN not set — cannot decode phone token');
    return null;
  }

  try {
    const response = await fetch('https://graph.zalo.me/v2.0/me/info', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        access_token: accessToken,
        secret_key: appSecretKey,
      },
      body: JSON.stringify({ data: phoneToken }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.error('[customers/update-phone] Zalo API HTTP error:', response.status);
      return null;
    }

    const result = await response.json() as { data?: { number?: string }; error?: number };

    if (result.error && result.error !== 0) {
      console.error('[customers/update-phone] Zalo API error code:', result.error);
      return null;
    }

    return result.data?.number ?? null;
  } catch (err) {
    console.error('[customers/update-phone] decodeZaloPhoneToken error:', err);
    return null;
  }
}
