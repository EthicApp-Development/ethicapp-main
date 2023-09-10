// src/App.js
import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import Institution from './pages/Institution';
import Home from './pages/Home';
import Reports from './pages/Reports';
import Users from './pages/Users';
import NavBar from './components/NavBars'
import SingleReport from './pages/SingleReport';
import Login from './pages/Login';

function App() {
  //TODO: Add an evolving script that checks the user token on reach view. If not logged in then redirect to login
  //      Make that if rendering login with existing stored token then auto redirect to admin home (/admin)
  
  return(
    <>
      <NavBar/>
      <Routes>
        {/* Redirect any unknown url to '/' */}
        <Route path="*" element={<Navigate to="/"/>}/>
        
        {/* Root redirect to login*/}
        <Route path="/" element={<Navigate to="/admin/login"/>}/>

        {/* Login does not have access to the NavBar.*/}
        <Route path="/admin/login" element={<Login/>}/>

        {/* All these pages have NavBar*/}
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
