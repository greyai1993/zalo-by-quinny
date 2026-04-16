export const metadata = {
  title: 'By Quinny Admin Centre',
  description: 'Zalo Centre admin management for By Quinny',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body style={{ margin: 0, fontFamily: 'Inter, Arial, sans-serif', background: '#F6F2EA', color: '#000' }}>
        {children}
      </body>
    </html>
  );
}
