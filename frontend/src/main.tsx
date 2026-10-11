import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';

import './styles.css';
import Landing from './pages/Landing';
import Booking from './pages/Booking';
import Manage from './pages/Manage';

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

// These three paths are also named explicitly in backend/src/app.ts, which
// serves index.html for each. Adding a page here means adding it there too —
// the alternative was a catch-all on the server, which would have swallowed
// the API routes that live under the same /:slug prefix.
createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/:slug" element={<Booking />} />
        <Route path="/:slug/manage" element={<Manage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
