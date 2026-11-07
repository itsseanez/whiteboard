import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';

import '@/styles/global.css';
import Landing from '@/pages/landing/Landing';
import Booking from '@/pages/booking/Booking';
import Manage from '@/pages/manage-booking/Manage';
import SignIn from '@/pages/auth/SignIn';
import Privacy from '@/pages/privacy/Privacy';
import { ForgotPassword, ResetPassword } from '@/pages/auth/PasswordReset';
import SignUp from '@/pages/auth/SignUp';
import Account from '@/pages/account/Account';
import Inbox from '@/pages/inbox/Inbox';
import Setup from '@/pages/setup/Setup';
import Calendar from '@/pages/calendar/Calendar';
import TopBar from '@/components/layout/TopBar';
import Invite from '@/pages/auth/Invite';
import MyWeek from '@/pages/my-week/MyWeek';

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

// These paths are also named explicitly in backend/src/app.ts, which
// serves index.html for each. Adding a page here means adding it there too —
// the alternative was a catch-all on the server, which would have swallowed
// the API routes that live under the same /:slug prefix. The static paths are
// also reserved slugs — see lib/slug.ts.
createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <TopBar />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/signin/forgot" element={<ForgotPassword />} />
        <Route path="/signin/reset" element={<ResetPassword />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/account" element={<Account />} />
        <Route path="/account/inbox" element={<Inbox />} />
        <Route path="/manage/:slug" element={<Setup />} />
        <Route path="/manage/:slug/calendar" element={<Calendar />} />
        <Route path="/manage/:slug/me" element={<MyWeek />} />
        <Route path="/invite/:id" element={<Invite />} />
        <Route path="/:slug" element={<Booking />} />
        <Route path="/:slug/manage" element={<Manage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
