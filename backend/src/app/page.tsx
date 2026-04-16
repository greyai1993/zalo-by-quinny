import Link from 'next/link';

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e8dfd2',
  borderRadius: 12,
  padding: 16,
  boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
};

async function getOrderStats(baseUrl: string) {
  try {
    const res = await fetch(`${baseUrl}/api/orders?limit=100`, { cache: 'no-store' });
    if (!res.ok) return { total: 0, pending: 0, shipping: 0 };
    const json = await res.json() as { orders?: Array<{ status: string }> };
    const orders = json.orders || [];
    return {
      total: orders.length,
      pending: orders.filter((o) => o.status === 'pending').length,
      shipping: orders.filter((o) => o.status === 'shipping').length,
    };
  } catch {
    return { total: 0, pending: 0, shipping: 0 };
  }
}

export default async function AdminHome() {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  const stats = await getOrderStats(baseUrl);

  return (
    <main style={{ maxWidth: 1080, margin: '0 auto', padding: 24 }}>
      <h1 style={{ margin: '0 0 8px', color: '#7C5F40' }}>By Quinny — Zalo Centre</h1>
      <p style={{ marginTop: 0, color: '#555' }}>Admin quản lý đơn hàng và danh mục sản phẩm</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12, marginBottom: 16 }}>
        <div style={cardStyle}><div style={{ color: '#666' }}>Tổng đơn</div><div style={{ fontSize: 28, fontWeight: 700 }}>{stats.total}</div></div>
        <div style={cardStyle}><div style={{ color: '#666' }}>Đơn chờ xử lý</div><div style={{ fontSize: 28, fontWeight: 700 }}>{stats.pending}</div></div>
        <div style={cardStyle}><div style={{ color: '#666' }}>Đơn đang giao</div><div style={{ fontSize: 28, fontWeight: 700 }}>{stats.shipping}</div></div>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <Link href="/admin/orders" style={{ ...cardStyle, textDecoration: 'none', color: '#000', flex: 1 }}>
          <strong>📦 Quản lý đơn hàng</strong>
          <div style={{ marginTop: 6, color: '#666' }}>Xem đơn và cập nhật trạng thái</div>
        </Link>

        <Link href="/admin/products" style={{ ...cardStyle, textDecoration: 'none', color: '#000', flex: 1 }}>
          <strong>🧵 Quản lý sản phẩm</strong>
          <div style={{ marginTop: 6, color: '#666' }}>Danh mục + trạng thái bán</div>
        </Link>
      </div>
    </main>
  );
}
