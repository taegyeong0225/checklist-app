import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ToastProvider } from './components/ToastProvider';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import EquipmentList from './pages/EquipmentList';
import EquipmentDetail from './pages/EquipmentDetail';
import ChecklistPage from './pages/ChecklistPage';
import TemplateManager from './pages/TemplateManager';

export default function App() {
  return (
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
  );
}
