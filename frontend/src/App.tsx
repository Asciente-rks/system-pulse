import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Nav from "./components/Nav";
import Home from "./pages/Home";
import Invite from "./pages/Invite";
import AcceptInvite from "./pages/AcceptInvite";
import Systems from "./pages/Systems";
import AssignAccess from "./pages/AssignAccess";

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <div className="bg-aura" />
        <header className="topbar">
          <div className="container-wrap">
            <Nav />
          </div>
        </header>
        <main className="container-wrap page-content">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/invite" element={<Invite />} />
            <Route path="/accept-invite" element={<AcceptInvite />} />
            <Route path="/systems" element={<Systems />} />
            <Route path="/assign" element={<AssignAccess />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
