/**
 * App — main application with react-router-dom routing.
 *
 * Routes:
 *   / → Landing page (Navbar + Hero + Features + HowItWorks + Footer)
 *   /dashboard → Workspace page (prompt input, scene list, video preview, editor)
 */

import { useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { HeroSection } from './components/HeroSection';
import { FeaturesSection } from './components/FeaturesSection';
import { FeatureSpotlight } from './components/FeatureSpotlight';
import { ExamplesSection } from './components/ExamplesSection';
import { HowItWorksSection } from './components/HowItWorksSection';
import { Footer } from './components/Footer';
import { DashboardPage } from './pages/DashboardPage';
import { AuthPage } from './pages/AuthPage';
import { AdminPage } from './pages/AdminPage';
import { ComingSoonPage } from './pages/ComingSoonPage';
import { ContactPage } from './pages/ContactPage';
import { HistoryPage } from './pages/HistoryPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthProvider } from './contexts/AuthContext';
import './index.css';

function LandingPage() {
  return (
    <div className="min-h-screen bg-navy-950 text-slate-100">
      <Navbar />
      <main>
        <HeroSection />
        <FeaturesSection />
        <FeatureSpotlight />
        <ExamplesSection />
        <HowItWorksSection />
      </main>
      <Footer />
    </div>
  );
}

/**
 * ScrollManager — on every route change, scroll to the hash anchor if one
 * is present (e.g. /#features) or to the top of the page otherwise. Lives
 * inside the Router so it can use useLocation().
 */
function ScrollManager() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      const id = hash.slice(1);
      // Defer one frame so the destination page has finished mounting.
      const timer = setTimeout(() => {
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
      return () => clearTimeout(timer);
    }
    window.scrollTo({ top: 0 });
  }, [pathname, hash]);
  return null;
}

function App() {
  return (
    <AuthProvider>
      <ScrollManager />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/signup" element={<AuthPage mode="signup" />} />
        <Route
          path="/dashboard/*"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <AdminPage />
            </ProtectedRoute>
          }
        />
        <Route path="/contact" element={<ContactPage />} />
        <Route
          path="/history"
          element={
            <ProtectedRoute>
              <HistoryPage />
            </ProtectedRoute>
          }
        />
        <Route path="/privacy" element={<ComingSoonPage title="Privacy Policy" />} />
        <Route path="/terms" element={<ComingSoonPage title="Terms of Service" />} />
        <Route path="/acceptable-use" element={<ComingSoonPage title="Acceptable Use" />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;
