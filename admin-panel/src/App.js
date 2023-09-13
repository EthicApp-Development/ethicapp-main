// src/App.js
import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import CssBaseline from '@mui/material/CssBaseline';
import Box from '@mui/material/Box';

import Institution from './pages/Institution';
import Home from './pages/Home';
import Reports from './pages/Reports';
import Users from './pages/Users';
import NavBar from './components/NavBars'
import SingleReport from './pages/SingleReport';
import Login from './pages/Login';

import {useTranslation} from "react-i18next"

function App() {
  //TODO: Add an evolving script that checks the user token on reach view. If not logged in then redirect to login
  //      Make that if rendering login with existing stored token then auto redirect to admin home (/admin)

  const [translation, i18n] = useTranslation("global")

  const handleChangeLanguage = ()=>{
    if(i18n.language=="es"){
      i18n.changeLanguage("en")
    }
    else{
      i18n.changeLanguage("es")
    }
  }
  
  return(
    <Box sx={{ display: 'flex' }}>
      <CssBaseline />
      <NavBar handleChangeLanguage={handleChangeLanguage} translation={translation}/>
      <Routes>
        {/* Redirect any unknown url to '/' */}
        <Route path="*" element={<Navigate to="/"/>}/>
        
        {/* Root redirect to login*/}
        <Route path="/" element={<Navigate to="/admin/login"/>}/>

        {/* Login does not have access to the NavBar.*/}
        <Route path="/admin/login" element={<Login/>}/>

        {/* All these pages have NavBar*/}
        <Route path="/admin" element={<Home translation={translation}/>}/>
        <Route path="/admin/institution" element={<Institution/>}/>
        <Route path="/admin/reports" element={<Reports/>}/>
        <Route path="/admin/users" element={<Users/>}/>
        <Route path="/admin/report/:reportEnum" element={<SingleReport/>}/>

      </Routes>
    </Box>
  )
}

export default App;
