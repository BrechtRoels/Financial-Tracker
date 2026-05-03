import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import MobileLayout from "./components/mobile/MobileLayout";
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
import { useIsMobile } from "./lib/useIsMobile";

function Protected({ children }: { children: JSX.Element }) {
  return getToken() ? children : <Navigate to="/login" replace />;
}

export default function App() {
  const m = useIsMobile();
  const Shell = m ? MobileLayout : Layout;
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
        <Route index element={m ? <MobileDashboard /> : <Dashboard />} />
        <Route path="/chat" element={m ? <MobileChat /> : <Chat />} />
        <Route path="/transactions" element={m ? <MobileTransactions /> : <Transactions />} />
        <Route path="/accounts" element={m ? <MobileAccounts /> : <Accounts />} />
        {m && <Route path="/more" element={<MobileMore />} />}
        <Route path="/merchants" element={<Merchants />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/budgets" element={<Budgets />} />
        <Route path="/categories" element={<Categories />} />
      </Route>
    </Routes>
  );
}
