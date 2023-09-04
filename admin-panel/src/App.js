// src/App.js
import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import Institution from './pages/Institution';
import Home from './pages/Home';
import Reports from './pages/Reports';
import Users from './pages/Users';

import Report1 from './pages/reports/start_activity'
import Report2 from './pages/reports/create_account'
import Report3 from './pages/reports/logins'
import Report4 from './pages/reports/top_professors'

import NavBar from './components/NavBars'

function App() {
  return(
    <>
    <NavBar/>
    <Routes>
      <Route path="/" element={<Navigate to="/admin"></Navigate>}/>
      <Route path="/institution" element={<Institution/>}/>
      <Route path="/admin" element={<Home/>}/>
      <Route path="/reports" element={<Reports/>}/>
      <Route path="/users" element={<Users/>}/>
      <Route path="/report/" element={<Institution/>}/>
      <Route path="/report/start_activity" element={<Report1/>}/>
      <Route path="/report/create_account" element={<Report2/>}/>
      <Route path="/report/logins" element={<Report3/>}/>
      <Route path="/report/top_professors" element={<Report4/>}/>
    </Routes>
    
    </>
  )
}

export default App;
