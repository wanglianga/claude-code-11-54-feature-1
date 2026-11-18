import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import './styles.css';
import { Layout } from './components/Layout';
import { SourcesPage } from './pages/SourcesPage';
import { CoveragePage } from './pages/CoveragePage';
import { MappingPage } from './pages/MappingPage';
import { RunsPage } from './pages/RunsPage';
import { ResultsPage } from './pages/ResultsPage';
import { ComplaintsPage } from './pages/ComplaintsPage';
import { ReportsPage } from './pages/ReportsPage';
import { MethodPage } from './pages/MethodPage';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/sources" replace />} />
          <Route path="/sources" element={<SourcesPage />} />
          <Route path="/coverage" element={<CoveragePage />} />
          <Route path="/mapping" element={<MappingPage />} />
          <Route path="/runs" element={<RunsPage />} />
          <Route path="/results" element={<ResultsPage />} />
          <Route path="/complaints" element={<ComplaintsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/method" element={<MethodPage />} />
          <Route path="*" element={<Navigate to="/sources" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  </StrictMode>,
);
