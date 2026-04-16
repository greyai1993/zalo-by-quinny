import React, { useState } from 'react';
import { App, ZMPRouter, AnimationRoutes, Route } from 'zmp-ui';
import './assets/theme.css';

// Pages
import HomePage from './pages/home';
import CatalogPage from './pages/catalog';
import ProductDetailPage from './pages/product-detail';
import CartPage from './pages/cart';
import CheckoutPage from './pages/checkout';
import OrderSuccessPage from './pages/order-success';
import OrderTrackingPage from './pages/order-tracking';
import ProfilePage from './pages/profile';
import SpinWheelPage from './pages/spin-wheel';

// Auth
import { useZaloAuth } from './hooks/useZaloAuth';

// ─── Login Screen ──────────────────────────────────────────────────────────────

const LoginScreen: React.FC<{ onLogin: () => void; isLoading: boolean; error: string | null; onGuestMode: () => void }> = ({
  onLogin,
  isLoading,
  error,
  onGuestMode,
}) => {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #8B6535 0%, #5a3d1f 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 24px',
        textAlign: 'center',
      }}
    >
      {/* Logo */}
      <div style={{ marginBottom: 32 }}>
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.15)',
            border: '2px solid rgba(255,255,255,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 36,
            margin: '0 auto 16px',
          }}
        >
          &#128919;
        </div>
        <div
          style={{
            fontSize: 26,
            fontWeight: 800,
            color: 'white',
            letterSpacing: 3,
            marginBottom: 6,
          }}
        >
          BY QUINNY
        </div>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.75)' }}>
          Thời trang nữ cao cấp
        </div>
      </div>

      {/* Description */}
      <div
        style={{
          background: 'rgba(255,255,255,0.12)',
          borderRadius: 16,
          padding: '20px 24px',
          marginBottom: 32,
          maxWidth: 320,
        }}
      >
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', lineHeight: 1.6 }}>
          Đăng nhập để mua sắm, theo dõi đơn hàng và tích điểm thành viên 🎁
        </div>
      </div>

      {/* Login button — user phải tự click */}
      <button
        onClick={onLogin}
        disabled={isLoading}
        style={{
          width: '100%',
          maxWidth: 320,
          padding: '14px 0',
          borderRadius: 12,
          background: isLoading ? 'rgba(255,255,255,0.4)' : 'white',
          color: '#8B6535',
          fontSize: 16,
          fontWeight: 700,
          border: 'none',
          cursor: isLoading ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          transition: 'opacity 0.2s',
        }}
      >
        {isLoading ? (
          <>
            <span style={{ fontSize: 18 }}>⏳</span> Đang đăng nhập...
          </>
        ) : (
          <>
            <span style={{ fontSize: 18 }}>🔵</span> Đăng nhập với Zalo
          </>
        )}
      </button>

      {error && (
        <div
          style={{
            marginTop: 16,
            padding: '10px 16px',
            background: 'rgba(229,57,53,0.15)',
            border: '1px solid rgba(229,57,53,0.4)',
            borderRadius: 8,
            color: '#ffcdd2',
            fontSize: 13,
            maxWidth: 320,
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {/* Skip login — browse as guest (for preview) */}
      <button
        onClick={onGuestMode}
        style={{
          background: 'none',
          border: 'none',
          color: 'rgba(255,255,255,0.6)',
          fontSize: 13,
          marginTop: 20,
          cursor: 'pointer',
          textDecoration: 'underline',
        }}
      >
        Xem sản phẩm trước
      </button>
    </div>
  );
};

// ─── App Routes ─────────────────────────────────────────────────────────────────

const AppRoutes: React.FC = () => {
  return (
    <ZMPRouter>
      <AnimationRoutes>
        <Route path="/" element={<HomePage />} />
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/product-detail" element={<ProductDetailPage />} />
        <Route path="/cart" element={<CartPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/order-success" element={<OrderSuccessPage />} />
        <Route path="/order-tracking" element={<OrderTrackingPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/spin-wheel" element={<SpinWheelPage />} />
      </AnimationRoutes>
    </ZMPRouter>
  );
};

// ─── Root App ───────────────────────────────────────────────────────────────────

const ByQuinnyApp: React.FC = () => {
  const { isAuthenticated, isLoading, error, login } = useZaloAuth();
  const [guestMode, setGuestMode] = useState(false);

  // Hiện login screen nếu chưa đăng nhập và không phải guest mode
  if (!isAuthenticated && !guestMode) {
    return (
      <App>
        <LoginScreen
          onLogin={login}
          isLoading={isLoading}
          error={error}
          onGuestMode={() => setGuestMode(true)}
        />
      </App>
    );
  }

  return (
    <App>
      <AppRoutes />
    </App>
  );
};

export default ByQuinnyApp;
