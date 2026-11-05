import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Server, ClipboardList, Settings, Download, Upload, Menu, X
} from 'lucide-react';
import { useState } from 'react';
import { exportAllData, importAllData } from '../utils/db';
import { useToast } from './ToastProvider';

const NAV_ITEMS = [
  { to: '/', label: '대시보드', icon: LayoutDashboard },
  { to: '/equipments', label: '설비 목록', icon: Server },
  { to: '/templates', label: '템플릿 관리', icon: ClipboardList },
];

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const addToast = useToast();

  async function handleExport() {
    try {
      const data = await exportAllData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `checklist_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      addToast('전체 백업을 내보냈습니다.', 'success');
    } catch {
      addToast('백업 내보내기 실패', 'error');
    }
  }

  async function handleImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await importAllData(data);
      addToast('백업을 가져왔습니다. 페이지를 새로고침합니다.', 'success');
      setTimeout(() => window.location.reload(), 1200);
    } catch {
      addToast('백업 가져오기 실패 - 올바른 백업 파일인지 확인하세요.', 'error');
    }
    e.target.value = '';
  }

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div className="app-layout">
      {/* Mobile overlay */}
      <div
        className={`sidebar-overlay ${sidebarOpen ? 'open' : ''}`}
        onClick={closeSidebar}
      />

      {/* Sidebar */}
      <nav className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">
          ⚙️ 설비 통신 점검
          <span>체크리스트 관리</span>
        </div>
        <div className="sidebar-nav">
          <div className="nav-section">메뉴</div>
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => isActive ? 'active' : ''}
              onClick={closeSidebar}
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}

          <div className="nav-section" style={{ marginTop: 16 }}>데이터</div>
          <button
            className="sidebar-nav-btn"
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '11px 16px', fontSize: 14, color: 'var(--color-sidebar-text)',
              borderRadius: 6, margin: '2px 8px', width: 'calc(100% - 16px)',
              background: 'none', border: 'none', cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onClick={handleExport}
          >
            <Download size={16} /> 전체 백업 내보내기
          </button>
          <label
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '11px 16px', fontSize: 14, color: 'var(--color-sidebar-text)',
              borderRadius: 6, margin: '2px 8px', cursor: 'pointer',
            }}
          >
            <Upload size={16} /> 백업 가져오기
            <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleImport} />
          </label>
        </div>
      </nav>

      {/* Main */}
      <div className="main-content">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              className="sidebar-toggle"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label="메뉴 열기"
            >
              {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <PageTitle />
          </div>
          <div className="topbar-actions" />
        </header>
        <div className="page-body">
          {children}
        </div>
      </div>
    </div>
  );
}

function PageTitle() {
  const { pathname } = useLocation();
  const map = {
    '/': '대시보드',
    '/equipments': '설비 목록',
    '/templates': '템플릿 관리',
  };
  const base = '/' + pathname.split('/')[1];
  if (pathname.includes('/equipments/') && pathname.includes('/checklist')) return <span className="topbar-title">점검 화면</span>;
  if (pathname.includes('/equipments/')) return <span className="topbar-title">설비 상세</span>;
  return <span className="topbar-title">{map[base] || '설비 통신 점검'}</span>;
}
