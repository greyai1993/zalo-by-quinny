/**
 * zns.ts — Zalo Notification Service (ZNS) module
 *
 * Send transactional Zalo messages via Zalo OA ZNS API.
 * Requires: ZALO_OA_ACCESS_TOKEN env var
 *
 * ZNS Templates for By Quinny:
 *   - ORDER_CONFIRMED  : Xác nhận đơn hàng
 *   - ORDER_SHIPPING   : Đơn đang giao
 *   - ORDER_DELIVERED  : Đơn đã giao + mời review
 *
 * ⚠️  MOCK MODE: If ZALO_OA_ACCESS_TOKEN is not set, logs to console
 *     and stores to zns_logs table with status='mock'.
 *     Replace with real OA token when Zalo OA is verified.
 *
 * Docs: https://developers.zalo.me/docs/zns/gui-tin-zns
 * API endpoint: POST https://business.openapi.zalo.me/message/template
 */

import { supabaseAdmin } from './supabase';

// ─── Constants ────────────────────────────────────────────────────────────────

const ZNS_API_URL = 'https://business.openapi.zalo.me/message/template';

/**
 * Template IDs — Replace with actual Zalo-approved template IDs.
 * Get from: Zalo OA Manager → ZNS → Template Management
 *
 * ⚠️  IMPORTANT: These are placeholder IDs.
 *     After Zalo OA is verified and templates approved:
 *     1. Login to oa.zalo.me → Tạo ZNS Template
 *     2. Get approved template_id (numeric string)
 *     3. Replace values below with actual template_ids
 *     4. Set ZALO_OA_ACCESS_TOKEN in env vars
 */
export const ZNS_TEMPLATES = {
  ORDER_CONFIRMED: process.env.ZALO_ZNS_TEMPLATE_ORDER_CONFIRMED || 'TEMPLATE_ORDER_CONFIRMED',
  ORDER_SHIPPING:  process.env.ZALO_ZNS_TEMPLATE_ORDER_SHIPPING  || 'TEMPLATE_ORDER_SHIPPING',
  ORDER_DELIVERED: process.env.ZALO_ZNS_TEMPLATE_ORDER_DELIVERED || 'TEMPLATE_ORDER_DELIVERED',
} as const;

export type ZNSTemplateKey = keyof typeof ZNS_TEMPLATES;

// ─── Template param definitions ───────────────────────────────────────────────
// These define what variables each template needs.
// Must match the template variables registered in Zalo OA Manager.

export interface ZNSParamsMap {
  ORDER_CONFIRMED: {
    order_id: string;        // Mã đơn hàng
    customer_name: string;   // Tên khách hàng
    total: string;           // Tổng tiền (formatted, e.g. "250,000đ")
    payment_method: string;  // "Thanh toán khi nhận hàng" | "Chuyển khoản"
  };
  ORDER_SHIPPING: {
    order_id: string;        // Mã đơn hàng
    shipper_name: string;    // Tên shipper (có thể rỗng)
  };
  ORDER_DELIVERED: {
    order_id: string;        // Mã đơn hàng
    customer_name: string;   // Tên khách hàng
  };
}

// ─── Response types ───────────────────────────────────────────────────────────

export interface ZNSResult {
  success: boolean;
  message_id?: string;
  error?: string;
  mock?: boolean;
}

// ─── Core send function ───────────────────────────────────────────────────────

/**
 * Send ZNS message to a phone number.
 *
 * @param phone - Vietnamese phone number (e.g. "0901234567" or "+84901234567")
 * @param templateId - ZNS template ID from ZNS_TEMPLATES
 * @param params - Template parameters (key-value)
 * @param referenceId - Optional reference (order_id, etc.) for logging
 */
export async function sendZNS(
  phone: string,
  templateId: string,
  params: Record<string, string>,
  referenceId?: string
): Promise<ZNSResult> {
  const accessToken = process.env.ZALO_OA_ACCESS_TOKEN;
  const normalizedPhone = normalizePhone(phone);

  // ── MOCK MODE ──────────────────────────────────────────────────────────────
  if (!accessToken || accessToken.startsWith('PLACEHOLDER')) {
    console.log(
      `[ZNS MOCK] Would send to ${normalizedPhone}:`,
      { templateId, params }
    );
    await logZNS({
      phone: normalizedPhone,
      template_id: templateId,
      params_json: params,
      status: 'mock',
      reference_id: referenceId,
      response_json: { mock: true, reason: 'ZALO_OA_ACCESS_TOKEN not set' },
    });
    return { success: true, mock: true };
  }

  // ── REAL SEND ──────────────────────────────────────────────────────────────
  try {
    const body = {
      phone: normalizedPhone,
      template_id: templateId,
      template_data: params,
      tracking_id: referenceId || `zns_${Date.now()}`,
    };

    const response = await fetch(ZNS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'access_token': accessToken,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    const result = await response.json() as {
      error: number;
      message: string;
      data?: { msg_id: string };
    };

    const success = result.error === 0;
    const messageId = result.data?.msg_id;

    await logZNS({
      phone: normalizedPhone,
      template_id: templateId,
      params_json: params,
      status: success ? 'sent' : 'failed',
      reference_id: referenceId,
      response_json: result,
    });

    if (!success) {
      console.error('[ZNS] Send failed:', result);
      return { success: false, error: result.message };
    }

    return { success: true, message_id: messageId };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[ZNS] Send error:', err);

    await logZNS({
      phone: normalizedPhone,
      template_id: templateId,
      params_json: params,
      status: 'error',
      reference_id: referenceId,
      response_json: { error: errMsg },
    });

    return { success: false, error: errMsg };
  }
}

// ─── Typed helpers ────────────────────────────────────────────────────────────

/** Type-safe wrapper for ORDER_CONFIRMED template */
export async function sendOrderConfirmed(
  phone: string,
  params: ZNSParamsMap['ORDER_CONFIRMED'],
  orderId?: string
): Promise<ZNSResult> {
  return sendZNS(phone, ZNS_TEMPLATES.ORDER_CONFIRMED, params, orderId);
}

/** Type-safe wrapper for ORDER_SHIPPING template */
export async function sendOrderShipping(
  phone: string,
  params: ZNSParamsMap['ORDER_SHIPPING'],
  orderId?: string
): Promise<ZNSResult> {
  return sendZNS(phone, ZNS_TEMPLATES.ORDER_SHIPPING, params, orderId);
}

/** Type-safe wrapper for ORDER_DELIVERED template */
export async function sendOrderDelivered(
  phone: string,
  params: ZNSParamsMap['ORDER_DELIVERED'],
  orderId?: string
): Promise<ZNSResult> {
  return sendZNS(phone, ZNS_TEMPLATES.ORDER_DELIVERED, params, orderId);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Normalize Vietnamese phone to 84xxx format */
function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/\s+/g, '').replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+84')) return cleaned.slice(1); // +84xxx → 84xxx
  if (cleaned.startsWith('84')) return cleaned;           // already 84xxx
  if (cleaned.startsWith('0')) return '84' + cleaned.slice(1); // 0xxx → 84xxx
  return cleaned;
}

/** Write ZNS send attempt to zns_logs table */
async function logZNS(data: {
  phone: string;
  template_id: string;
  params_json: Record<string, string>;
  status: 'sent' | 'failed' | 'error' | 'mock';
  reference_id?: string;
  response_json: unknown;
}): Promise<void> {
  try {
    await supabaseAdmin.from('zns_logs').insert({
      phone: data.phone,
      template_id: data.template_id,
      params_json: data.params_json,
      status: data.status,
      reference_id: data.reference_id || null,
      response_json: data.response_json,
    });
  } catch (err) {
    // Non-fatal — don't let logging failures affect ZNS send result
    console.warn('[ZNS] Logging to DB failed:', err);
  }
}
