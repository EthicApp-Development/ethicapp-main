// src/App.js
import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import Institution from './pages/Institution';
import Home from './pages/Home';
import Reports from './pages/Reports';
import Users from './pages/Users';
import NavBar from './components/NavBars'
import SingleReport from './pages/SingleReport';

function App() {
  return(
    <>
    <NavBar/>
    <Routes>
      <Route path="/" element={<Navigate to="/admin"></Navigate>}/>
      <Route path="/admin/institution" element={<Institution/>}/>
      <Route path="/admin" element={<Home/>}/>
      <Route path="/admin/reports" element={<Reports/>}/>
      <Route path="/admin/users" element={<Users/>}/>
      <Route path="/admin/report/:reportEnum" element={<SingleReport/>}/>
    </Routes>
    
    </>
  )
}

export default App;
