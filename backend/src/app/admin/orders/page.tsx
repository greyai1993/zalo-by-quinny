'use client';

import { useEffect, useMemo, useState } from 'react';

type OrderStatus = 'pending' | 'confirmed' | 'shipping' | 'delivered' | 'cancelled';

type OrderItem = {
  product_name?: string;
  qty?: number;
  unit_price?: number;
};

type Order = {
  id: string;
  order_no: string;
  customer_id: string;
  total: number;
  status: OrderStatus;
  payment_method: string;
  created_at: string;
  items_json?: OrderItem[];
};

const statusOptions: OrderStatus[] = ['pending', 'confirmed', 'shipping', 'delivered', 'cancelled'];

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [updatingId, setUpdatingId] = useState<string>('');

  async function fetchOrders() {
    setLoading(true);
    try {
      const url = statusFilter === 'all'
        ? '/api/orders?limit=100'
        : `/api/orders?limit=100&status=${encodeURIComponent(statusFilter)}`;
      const res = await fetch(url);
      const json = await res.json() as { orders?: Order[] };
      setOrders(json.orders || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchOrders();
  }, [statusFilter]);

  async function updateStatus(id: string, status: OrderStatus) {
    setUpdatingId(id);
    try {
      await fetch(`/api/orders/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      await fetchOrders();
    } finally {
      setUpdatingId('');
    }
  }

  const summary = useMemo(() => ({
    total: orders.length,
    pending: orders.filter((o) => o.status === 'pending').length,
    shipping: orders.filter((o) => o.status === 'shipping').length,
  }), [orders]);

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>
      <h1 style={{ marginTop: 0, color: '#7C5F40' }}>📦 Admin — Quản lý đơn hàng</h1>

      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        <div style={{ background: '#fff', border: '1px solid #e8dfd2', borderRadius: 10, padding: 12 }}>Tổng đơn: <b>{summary.total}</b></div>
        <div style={{ background: '#fff', border: '1px solid #e8dfd2', borderRadius: 10, padding: 12 }}>Chờ xử lý: <b>{summary.pending}</b></div>
        <div style={{ background: '#fff', border: '1px solid #e8dfd2', borderRadius: 10, padding: 12 }}>Đang giao: <b>{summary.shipping}</b></div>
      </div>

      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <label>Filter trạng thái:</label>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">Tất cả</option>
          {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid #e8dfd2', borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f7f2e9' }}>
              <th style={th}>Mã đơn</th>
              <th style={th}>Ngày tạo</th>
              <th style={th}>Sản phẩm</th>
              <th style={th}>Tổng tiền</th>
              <th style={th}>Thanh toán</th>
              <th style={th}>Trạng thái</th>
              <th style={th}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td style={td} colSpan={7}>Đang tải...</td></tr>
            ) : orders.length === 0 ? (
              <tr><td style={td} colSpan={7}>Không có đơn hàng</td></tr>
            ) : orders.map((o) => (
              <tr key={o.id}>
                <td style={td}><b>{o.order_no}</b></td>
                <td style={td}>{new Date(o.created_at).toLocaleString('vi-VN')}</td>
                <td style={td}>{(o.items_json || []).map((i) => `${i.product_name || 'SP'} x${i.qty || 1}`).join(', ') || '-'}</td>
                <td style={td}>{o.total.toLocaleString('vi-VN')}đ</td>
                <td style={td}>{o.payment_method}</td>
                <td style={td}><span style={{ textTransform: 'capitalize' }}>{o.status}</span></td>
                <td style={td}>
                  <select
                    value={o.status}
                    disabled={updatingId === o.id}
                    onChange={(e) => updateStatus(o.id, e.target.value as OrderStatus)}
                  >
                    {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: 10, fontSize: 13 };
const td: React.CSSProperties = { padding: 10, borderTop: '1px solid #f0e7da', fontSize: 13, verticalAlign: 'top' };
