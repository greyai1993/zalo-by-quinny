/**
 * supabase.ts — Supabase client for backend (Vercel/Next.js)
 * Uses service_role key (bypasses RLS) — NEVER expose to client
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
if (!supabaseServiceKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

// Admin client — full access, server-side only
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Anon client — for public queries
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ─── Types ─────────────────────────────────────────────────

export type Tier = 'bronze' | 'silver' | 'gold' | 'vip';
export type OrderStatus = 'pending' | 'confirmed' | 'shipping' | 'delivered' | 'cancelled';
export type PaymentMethod = 'cod' | 'zalopay' | 'momo' | 'transfer' | 'loyalty_points';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export interface Customer {
  id: string;
  zalo_user_id: string;
  phone?: string;
  name: string;
  avatar_url?: string;
  tier: Tier;
  total_points: number;
  total_spent: number;
  order_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  sku?: string;
  name: string;
  description?: string;
  category_id?: string;
  price: number;
  sale_price?: number;
  images: string[];
  status: 'active' | 'inactive' | 'draft';
  is_featured: boolean;
}

export interface Variant {
  id: string;
  product_id: string;
  sku?: string;
  color?: string;
  size?: string;
  price?: number;
  sale_price?: number;
  stock_qty: number;
  is_active: boolean;
}

export interface CartItem {
  id: string;
  customer_id: string;
  product_id: string;
  variant_id?: string;
  qty: number;
  product?: Product;
  variant?: Variant;
}

export interface Order {
  id: string;
  order_no: string;
  customer_id: string;
  zalo_user_id?: string;
  items_json: OrderItemJson[];
  subtotal: number;
  discount: number;
  shipping_fee: number;
  total: number;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  status: OrderStatus;
  shipping_address?: ShippingAddress;
  note?: string;
  abit_invoice_no?: string;
  voucher_code?: string;
  loyalty_points_used: number;
  created_at: string;
  updated_at: string;
}

export interface OrderItemJson {
  product_id: string;
  variant_id?: string;
  product_name: string;
  variant_name?: string;
  sku?: string;
  qty: number;
  unit_price: number;
  total_price: number;
  image_url?: string;
}

export interface ShippingAddress {
  name: string;
  phone: string;
  address: string;
  district?: string;
  city: string;
}

export interface LoyaltyPoint {
  id: string;
  customer_id: string;
  points: number;
  action: string;
  reference_id?: string;
  note?: string;
  expires_at?: string;
  created_at: string;
}
