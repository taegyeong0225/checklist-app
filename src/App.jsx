import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ToastProvider } from './components/ToastProvider';
import AuthGate from './components/AuthGate';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import EquipmentList from './pages/EquipmentList';
import EquipmentDetail from './pages/EquipmentDetail';
import ChecklistPage from './pages/ChecklistPage';
import TemplateManager from './pages/TemplateManager';
import { supabase } from './lib/supabase';

function RealtimeRefresh({ children }) {
  useEffect(() => {
    if (!supabase) return undefined;
    const channel = supabase.channel('checklist-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => {
        if (Date.now() - (window.__checklistLastWriteAt || 0) > 1500) window.location.reload();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);
  return children;
}

export default function App() {
  return (
    <AuthGate>
      <RealtimeRefresh>
        <BrowserRouter>
          <ToastProvider>
            <Layout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/equipments" element={<EquipmentList />} />
                <Route path="/equipments/:id" element={<EquipmentDetail />} />
                <Route path="/equipments/:equipmentId/checklist/:checklistId" element={<ChecklistPage />} />
                <Route path="/templates" element={<TemplateManager />} />
              </Routes>
            </Layout>
          </ToastProvider>
        </BrowserRouter>
      </RealtimeRefresh>
    </AuthGate>
  );
}
