import { Navigate } from "react-router-dom";
import { useAuthBridge } from "../lib/AuthBridge";

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, isLoading } = useAuthBridge();
  if (isLoading) return <p className="center">Loading…</p>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}
