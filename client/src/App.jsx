import { Routes, Route, Navigate } from 'react-router-dom';
import CarpoolDetail from './pages/CarpoolDetail.jsx';
import AdminPanel from './pages/AdminPanel.jsx';
import AdminCarpoolDetail from './pages/AdminCarpoolDetail.jsx';
import GroupOverview from './pages/GroupOverview.jsx';
import GroupDetail from './pages/GroupDetail.jsx';
import HomePage from './pages/HomePage.jsx';

export default function App() {
  return (
    <div className="app-container">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/carpool/:id" element={<CarpoolDetail />} />
        <Route path="/admin" element={<AdminPanel />} />
        <Route path="/admin/groups" element={<GroupOverview />} />
        <Route path="/admin/groups/:groupId" element={<GroupDetail />} />
        <Route path="/admin/carpool/:id" element={<AdminCarpoolDetail />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
