import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { lazy, Suspense } from "react";

// Route-level code splitting: /auth visitors don't download the studio,
// and the studio doesn't wait on the auth page.
const Index = lazy(() => import("./pages/Index"));
const Auth = lazy(() => import("./pages/Auth"));
const GuestStudio = lazy(() => import("./pages/GuestStudio"));
const OAuthCallback = lazy(() => import("./pages/OAuthCallback"));
const Editor = lazy(() => import("./pages/Editor"));
const Admin = lazy(() => import("./pages/Admin"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const RouteFallback = () => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <div className="h-8 w-8 rounded-lg bg-primary/20 animate-pulse" />
  </div>
);

const App = () => (
  <ErrorBoundary>
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <BrowserRouter>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              {/* Public: invited guests have no account — join by opaque token */}
              <Route path="/guest/:inviteToken" element={<GuestStudio />} />
              {/* Public: OAuth popup landing — relays code to the opener */}
              <Route path="/oauth/callback" element={<OAuthCallback />} />
              {/* Standalone editor window (own route, no studio provider) */}
              <Route path="/editor" element={<ProtectedRoute><Editor /></ProtectedRoute>} />
              {/* Hidden admin panel — unlinked path, own credential system */}
              <Route path="/ed/admin" element={<Admin />} />
              <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
