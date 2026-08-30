import { BrowserRouter, Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import VisitForm from "./pages/VisitForm";
import VisitStatus from "./pages/VisitStatus";
import AdminApp from "./pages/admin/AdminApp";
import FormEditor from "./pages/admin/FormEditor";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/admin" element={<AdminApp />} />
        <Route path="/admin/forms/:id" element={<FormEditor />} />
        <Route path="/:slug" element={<VisitForm />} />
        <Route path="/:slug/status" element={<VisitStatus />} />
        <Route path="/" element={<Home />} />
      </Routes>
    </BrowserRouter>
  );
}
