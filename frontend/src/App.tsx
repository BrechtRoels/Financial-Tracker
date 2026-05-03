import { Navigate, Route, Routes } from "react-router-dom";
import AdminShell from "./components/AdminShell";
import Layout from "./components/Layout";
import MobileLayout from "./components/mobile/MobileLayout";
import Admin from "./pages/Admin";
import Dashboard from "./pages/Dashboard";
import Transactions from "./pages/Transactions";
import Accounts from "./pages/Accounts";
import Budgets from "./pages/Budgets";
import Categories from "./pages/Categories";
import Chat from "./pages/Chat";
import Login from "./pages/Login";
import Merchants from "./pages/Merchants";
import Reports from "./pages/Reports";
import MobileDashboard from "./pages/mobile/MobileDashboard";
import MobileTransactions from "./pages/mobile/MobileTransactions";
import MobileChat from "./pages/mobile/MobileChat";
import MobileAccounts from "./pages/mobile/MobileAccounts";
import MobileMore from "./pages/mobile/MobileMore";
import MobileLogin from "./pages/mobile/MobileLogin";
import { getToken } from "./api/client";
import { useMe } from "./hooks/useAuth";
import { useIsMobile } from "./lib/useIsMobile";

function Protected({ children }: { children: JSX.Element }) {
  return getToken() ? children : <Navigate to="/login" replace />;
}

export default function App() {
  const m = useIsMobile();
  const me = useMe();
  const hasToken = !!getToken();

  // Wait for /auth/me before deciding shell — avoids a flash of the wrong UI
  // (e.g. admin briefly seeing the Dashboard) right after login.
  if (hasToken && me.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-subink text-sm">
        Loading…
      </div>
    );
  }

  const isAdmin = me.data?.is_admin === true;
  const Shell = isAdmin ? AdminShell : m ? MobileLayout : Layout;

  return (
    <Routes>
      <Route path="/login" element={m ? <MobileLogin /> : <Login />} />
      <Route
        element={
          <Protected>
            <Shell />
          </Protected>
        }
      >
        {isAdmin ? (
          <>
            <Route path="/admin" element={<Admin />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </>
        ) : (
          <>
            <Route index element={m ? <MobileDashboard /> : <Dashboard />} />
            <Route path="/chat" element={m ? <MobileChat /> : <Chat />} />
            <Route path="/transactions" element={m ? <MobileTransactions /> : <Transactions />} />
            <Route path="/accounts" element={m ? <MobileAccounts /> : <Accounts />} />
            {m && <Route path="/more" element={<MobileMore />} />}
            <Route path="/merchants" element={<Merchants />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/budgets" element={<Budgets />} />
            <Route path="/categories" element={<Categories />} />
          </>
        )}
      </Route>
    </Routes>
  );
}
