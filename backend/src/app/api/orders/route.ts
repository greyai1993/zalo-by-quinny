/**
 * GET  /api/orders — List orders (with filters)
 * POST /api/orders — Create new order from Mini App
 *
 * POST body:
 *   {
 *     customer_id, zalo_user_id,
 *     items: [{ product_id, variant_id?, product_name, variant_name?, sku?, qty, unit_price }],
 *     payment_method: 'cod' | 'zalopay' | 'momo' | 'transfer' | 'loyalty_points',
 *     shipping_address: { name, phone, address, district?, city },
 *     voucher_code?,
 *     loyalty_points_used?,
 *     note?,
 *     shipping_fee?
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, OrderItemJson } from '@/lib/supabase';
import { sendZNS, ZNS_TEMPLATES } from '@/lib/zns';
import { sendTelegramMessage } from '@/lib/telegram';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateOrderNo(): string {
  const now = new Date();
  const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, '');
  const ms = now.getMilliseconds().toString().padStart(3, '0');
  // crypto.randomUUID() — collision-proof, no Math.random()
  const uuid = crypto.randomUUID().replace(/-/g, '').substring(0, 6).toUpperCase();
  return `BQ${yyyymmdd}${ms}${uuid}`;
}

function validateCreateOrder(body: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!body.customer_id) errors.push('customer_id is required');
  if (!Array.isArray(body.items) || body.items.length === 0) {
    errors.push('items must be a non-empty array');
  }
  if (!body.payment_method) errors.push('payment_method is required');
  if (!body.shipping_address) errors.push('shipping_address is required');
  if (body.shipping_address && typeof body.shipping_address === 'object') {
    const addr = body.shipping_address as Record<string, unknown>;
    if (!addr.name) errors.push('shipping_address.name is required');
    if (!addr.phone) errors.push('shipping_address.phone is required');
    if (!addr.address) errors.push('shipping_address.address is required');
    if (!addr.city) errors.push('shipping_address.city is required');
  }
  return errors;
}

function formatAddress(addr: { name: string; phone: string; address: string; district?: string; city: string }) {
  const chunks = [addr.address, addr.district, addr.city].filter(Boolean);
  return chunks.join(', ');
}

// ─── GET /api/orders ──────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const customerId = searchParams.get('customer_id');
    const zaloUserId = searchParams.get('zalo_user_id');
    const status = searchParams.get('status');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')));
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('orders')
      .select(
        `id, order_no, customer_id, zalo_user_id, items_json,
         subtotal, discount, shipping_fee, total,
         payment_method, payment_status, status,
         shipping_address, note, abit_invoice_no,
         loyalty_points_used, created_at, updated_at,
         customer:customers(id, name, phone, avatar_url, tier)`,
        { count: 'exact' }
      )
      .range(offset, offset + limit - 1)
      .order('created_at', { ascending: false });

    if (customerId) query = query.eq('customer_id', customerId);
    if (zaloUserId) query = query.eq('zalo_user_id', zaloUserId);
    if (status) query = query.eq('status', status);

    const { data, error, count } = await query;

    if (error) {
      console.error('[orders] GET supabase error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      orders: data ?? [],
      pagination: {
        page, limit,
        total: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / limit),
        hasMore: (data?.length ?? 0) === limit,
      },
    });
  } catch (err) {
    console.error('[orders] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── POST /api/orders ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const errors = validateCreateOrder(body);
    if (errors.length > 0) {
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 });
    }

    const {
      customer_id, zalo_user_id,
      items, payment_method,
      shipping_address, note,
      voucher_code, loyalty_points_used = 0,
      shipping_fee = 0,
    } = body as {
      customer_id: string; zalo_user_id?: string;
      items: OrderItemJson[];
      payment_method: string;
      shipping_address: { name: string; phone: string; address: string; district?: string; city: string };
      note?: string; voucher_code?: string;
      loyalty_points_used?: number; shipping_fee?: number;
    };

    // Calculate totals
    const subtotal = items.reduce((sum, item) => {
      const itemTotal = (item.unit_price ?? 0) * (item.qty ?? 1);
      // Attach total_price to each item
      item.total_price = itemTotal;
      return sum + itemTotal;
    }, 0);

    // Apply voucher discount
    let discount = 0;
    if (voucher_code) {
      const { data: voucher } = await supabaseAdmin
        .from('vouchers')
        .select('id, discount_amount, discount_percent, min_order, used_by_customer_id')
        .eq('code', voucher_code.toUpperCase())
        .is('used_by_customer_id', null) // not used yet
        .single();

      if (voucher) {
        if (subtotal >= (voucher.min_order ?? 0)) {
          discount = voucher.discount_amount
            ?? Math.floor(subtotal * (voucher.discount_percent ?? 0) / 100);
        }
      }
    }

    // Loyalty points deduction: 1 point = 1,000đ
    const pointsDiscount = loyalty_points_used * 1000;
    const total = Math.max(0, subtotal - discount - pointsDiscount + shipping_fee);

    // Atomic stock reservation per variant (prevents oversell race condition)
    const reservedVariants: Array<{ variantId: string; qty: number }> = [];
    const reserveVariantStock = async (variantId: string, qty: number) => {
      const { data, error } = await supabaseAdmin.rpc('place_order_atomic', {
        p_variant_id: variantId,
        p_qty: qty,
      });

      if (error) {
        throw new Error(`Stock reservation error for variant ${variantId}: ${error.message}`);
      }

      if (!data) {
        throw new Error(`Insufficient stock for variant ${variantId}`);
      }

      reservedVariants.push({ variantId, qty });
    };

    const releaseReservedStock = async () => {
      for (const reserved of reservedVariants) {
        const { data: variant } = await supabaseAdmin
          .from('variants')
          .select('id, stock_qty')
          .eq('id', reserved.variantId)
          .single();

        if (!variant) continue;

        try {
          await supabaseAdmin
            .from('variants')
            .update({
              stock_qty: Math.max(0, Number(variant.stock_qty ?? 0) + reserved.qty),
              updated_at: new Date().toISOString(),
            })
            .eq('id', reserved.variantId);
        } catch {
          // ignore rollback failure for a single variant
        }
      }
    };

    // Check which products allow preorder (skip stock check for those)
    const itemProductIds = [...new Set(items.map((it: OrderItemJson) => it.product_id).filter(Boolean))];
    let preorderProductIds: Set<string> = new Set();
    if (itemProductIds.length > 0) {
      const { data: preorderCheck } = await supabaseAdmin
        .from('products')
        .select('id, allow_preorder')
        .in('id', itemProductIds)
        .eq('allow_preorder', true);
      if (preorderCheck) {
        preorderProductIds = new Set(preorderCheck.map((p: { id: string }) => p.id));
      }
    }

    try {
      for (const item of items) {
        if (!item.variant_id) continue;
        // Skip stock reservation for preorder products
        if (item.product_id && preorderProductIds.has(item.product_id)) continue;
        await reserveVariantStock(item.variant_id, Math.max(1, Number(item.qty ?? 1)));
      }
    } catch (stockErr) {
      await releaseReservedStock();
      return NextResponse.json(
        { error: stockErr instanceof Error ? stockErr.message : 'Insufficient stock' },
        { status: 409 },
      );
    }

    // Determine if this is a preorder
    let orderType = 'normal';
    let expectedShipDate: string | null = null;

    // Check each item's product for preorder status
    const productIds = [...new Set(items.map((it: OrderItemJson) => it.product_id).filter(Boolean))];
    if (productIds.length > 0) {
      const { data: productsData } = await supabaseAdmin
        .from('products')
        .select('id, allow_preorder, preorder_days')
        .in('id', productIds);

      if (productsData?.some((p: { allow_preorder: boolean }) => p.allow_preorder)) {
        orderType = 'preorder';
        // Use the longest preorder_days from all items
        const maxDays = Math.max(
          ...productsData
            .filter((p: { allow_preorder: boolean }) => p.allow_preorder)
            .map((p: { preorder_days: number }) => p.preorder_days || 7)
        );
        const shipDate = new Date();
        shipDate.setDate(shipDate.getDate() + maxDays);
        expectedShipDate = shipDate.toISOString();
      }
    }

    // Create order
    const orderNo = generateOrderNo();
    const { data: order, error: orderErr } = await supabaseAdmin
      .from('orders')
      .insert({
        order_no: orderNo,
        customer_id,
        zalo_user_id: zalo_user_id || null,
        items_json: items,
        subtotal,
        discount,
        shipping_fee,
        total,
        payment_method,
        payment_status: 'pending',
        status: orderType === 'preorder' ? 'preorder_pending' : 'pending',
        shipping_address,
        note: note || null,
        voucher_code: voucher_code || null,
        loyalty_points_used,
        order_type: orderType,
        expected_ship_date: expectedShipDate,
      })
      .select('id, order_no, status, total, payment_method, created_at')
      .single();

    if (orderErr) {
      await releaseReservedStock();
      console.error('[orders] POST insert error:', orderErr);
      return NextResponse.json({ error: orderErr.message }, { status: 500 });
    }

    // Mark voucher as used
    if (voucher_code && discount > 0) {
      await supabaseAdmin
        .from('vouchers')
        .update({ used_by_customer_id: customer_id })
        .eq('code', voucher_code.toUpperCase());
    }

    // Deduct loyalty points if used
    if (loyalty_points_used > 0) {
      await supabaseAdmin
        .from('loyalty_points')
        .insert({
          customer_id,
          points: -loyalty_points_used,
          action: 'redeem',
          reference_id: order.id,
          note: `Dùng điểm cho đơn ${orderNo}`,
        });

      await supabaseAdmin.rpc('decrement_customer_points', {
        p_customer_id: customer_id,
        p_points: loyalty_points_used,
      });
    }

    // Clear cart for this customer
    await supabaseAdmin
      .from('cart_items')
      .delete()
      .eq('customer_id', customer_id);

    // Send ZNS: order confirmation
    const { data: customer } = await supabaseAdmin
      .from('customers')
      .select('phone, name')
      .eq('id', customer_id)
      .single();

    if (customer?.phone) {
      await sendZNS(customer.phone, ZNS_TEMPLATES.ORDER_CONFIRMED, {
        order_id: orderNo,
        customer_name: customer.name,
        total: total.toLocaleString('vi-VN') + 'đ',
        payment_method: payment_method === 'cod' ? 'Thanh toán khi nhận hàng' : 'Chuyển khoản',
      });
    }

    // Telegram notification for admin
    try {
      const paymentLabel: Record<string, string> = {
        cod: 'COD (Thanh toán khi nhận)',
        transfer: 'Chuyển khoản',
        zalopay: 'ZaloPay',
        momo: 'MoMo',
        loyalty_points: 'Điểm tích lũy',
      };

      const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

      const itemsSummary = items
        .slice(0, 5)
        .map((it) => `🔹 ${it.product_name || 'Sản phẩm'}${it.variant_name ? ` (${it.variant_name})` : ''} x${it.qty ?? 1}`)
        .join('\n');

      const overflow = items.length > 5 ? `\n... +${items.length - 5} sản phẩm khác` : '';

      const telegramText = [
        orderType === 'preorder' 
          ? '📦 <b>ĐƠN ĐẶT TRƯỚC MỚI — By Quinny</b>' 
          : '🛍️ <b>ĐƠN HÀNG MỚI — By Quinny</b>',
        '📱 Nguồn: <b>Zalo Mini App</b>',
        '',
        `🔖 Mã đơn: <b>${orderNo}</b>`,
        `👤 Khách: ${shipping_address.name} | ${shipping_address.phone}`,
        `📍 Địa chỉ: ${formatAddress(shipping_address)}`,
        `🛍️ Sản phẩm:\n${itemsSummary}${overflow}`,
        `💰 Tổng: <b>${total.toLocaleString('vi-VN')} VNĐ</b>`,
        `💳 Thanh toán: ${paymentLabel[payment_method] ?? payment_method}`,
        `🕐 Thời gian: ${now}`,
        expectedShipDate ? `📦 Dự kiến giao: <b>${new Date(expectedShipDate).toLocaleDateString('vi-VN')}</b>` : '',
        note ? `📝 Ghi chú: ${note}` : '',
      ].filter(Boolean).join('\n');

      const tg = await sendTelegramMessage(telegramText);
      if (!tg) {
        console.warn('[orders] Telegram notification not sent:', tg);
      }
    } catch (tgErr) {
      console.warn('[orders] Telegram notification failed:', tgErr);
    }

    // Trigger Abit sync (non-blocking)
    fetch(`${process.env.NEXT_PUBLIC_API_URL ?? ''}/api/sync/abit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.SYNC_SECRET_KEY
          ? { 'x-sync-secret': process.env.SYNC_SECRET_KEY }
          : {}),
      },
      body: JSON.stringify({ order_id: order.id }),
    }).catch((e) => console.warn('[orders] Abit sync trigger failed:', e));

    return NextResponse.json(order, { status: 201 });
  } catch (err) {
    console.error('[orders] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
