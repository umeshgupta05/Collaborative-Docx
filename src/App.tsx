import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import { Toaster } from "@/components/ui/toaster";
import Index from "@/pages/Index";
import Dashboard from "@/pages/Dashboard";
import Document from "@/pages/Document";
import Auth from "@/pages/Auth";
import SharedDocument from "@/pages/SharedDocument";
import DownloadByCode from "@/pages/DownloadByCode";
import DownloadFolderByCode from "@/pages/DownloadFolderByCode";
import NotFound from "@/pages/NotFound";
import "./App.css";

const queryClient = new QueryClient();

const UI_MODE_KEY = "ui-mode";

const applyUiMode = (mode: string | null) => {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  if (mode === "light") root.classList.add("light");
  if (mode === "dark") root.classList.add("dark");
};

function App() {
  useEffect(() => {
    applyUiMode(localStorage.getItem(UI_MODE_KEY));
  }, []);

  return (
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/documents/:id" element={<Document />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/shared/:token" element={<SharedDocument />} />
            <Route path="/download" element={<DownloadByCode />} />
            <Route path="/download-folder" element={<DownloadFolderByCode />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
        <Toaster />
      </QueryClientProvider>
    </HelmetProvider>
  );
}

export default App;
