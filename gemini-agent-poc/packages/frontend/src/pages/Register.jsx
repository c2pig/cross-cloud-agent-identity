import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useAuthBridge } from "../lib/AuthBridge";

export default function Register() {
  const { login, isAuthenticated, isLoading } = useAuthBridge();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) login("signup");
  }, [isLoading, isAuthenticated, login]);

  if (isAuthenticated) return <Navigate to="/chat" replace />;
  return <p className="center">Redirecting to account registration…</p>;
}
