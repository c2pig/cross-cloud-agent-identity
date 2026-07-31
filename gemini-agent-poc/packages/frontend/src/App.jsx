import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthBridgeProvider } from "./lib/AuthBridge";
import { AUTH0_CONFIGURED, ALLOW_MOCK_AUTH } from "./lib/config";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Register from "./pages/Register";
import MockLogin from "./pages/MockLogin";
import Chat from "./pages/Chat";
import ProtectedRoute from "./components/ProtectedRoute";

export default function App() {
  return (
    <AuthBridgeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          {!AUTH0_CONFIGURED && ALLOW_MOCK_AUTH && (
            <Route path="/mock-login" element={<MockLogin />} />
          )}
          <Route
            path="/chat"
            element={
              <ProtectedRoute>
                <Chat />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthBridgeProvider>
  );
}
