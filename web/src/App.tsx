import { BrowserRouter, Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import VisitForm from "./pages/VisitForm";
import VisitStatus from "./pages/VisitStatus";
import AdminApp from "./pages/admin/AdminApp";
import QueueCheck from "./pages/QueueCheck";
import FormEditor from "./pages/admin/FormEditor";
import PromoPage from "./pages/promo/PromoPage";
import VoucherPage from "./pages/promo/VoucherPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/admin" element={<AdminApp />} />
        <Route path="/admin/forms/:id" element={<FormEditor />} />
        <Route path="/antrean" element={<QueueCheck />} />
        <Route path="/11-11" element={<PromoPage id="11-11" />} />
        <Route path="/v/:token" element={<VoucherPage />} />
        <Route path="/:slug" element={<VisitForm />} />
        <Route path="/:slug/status" element={<VisitStatus />} />
        <Route path="/" element={<Home />} />
      </Routes>
    </BrowserRouter>
  );
}
