/**
 * App — main application with react-router-dom routing.
 *
 * Routes:
 *   / → Landing page (Navbar + Hero + Features + HowItWorks + Footer)
 *   /dashboard → Workspace page (prompt input, scene list, video preview, editor)
 */

import { Routes, Route } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { HeroSection } from './components/HeroSection';
import { FeaturesSection } from './components/FeaturesSection';
import { ExamplesSection } from './components/ExamplesSection';
import { HowItWorksSection } from './components/HowItWorksSection';
import { Footer } from './components/Footer';
import { DashboardPage } from './pages/DashboardPage';
import './index.css';

function LandingPage() {
  return (
    <div className="min-h-screen bg-navy-950 text-slate-100">
      <Navbar />
      <main>
        <HeroSection />
        <FeaturesSection />
        <ExamplesSection />
        <HowItWorksSection />
      </main>
      <Footer />
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/dashboard/*" element={<DashboardPage />} />
    </Routes>
  );
}

export default App;
