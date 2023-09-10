import React from 'react';
import { Link } from 'react-router-dom';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import Container from '@mui/material/Container';

function Reports() {
  return(
    <Box
      component="main"
      sx={{
        backgroundColor: (theme) =>
          theme.palette.mode === 'light'
            ? theme.palette.grey[100]
            : theme.palette.grey[900],
        flexGrow: 1,
        height: '100vh',
        overflow: 'auto',
      }}
    >
      <Toolbar />
      <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
        <h2>Reports Page</h2>
        <h2>Show all reports Here</h2>
        <ul>
          <li><Link to="/admin/report/start_activity">Get Report Chart 1</Link></li>
          <li><Link to="/admin/report/create_account">Get Report Chart 2</Link></li>
          <li><Link to="/admin/report/logins">Get Report Chart 3</Link></li>
          <li><Link to="/admin/report/top_professors">Get Report Chart 4</Link></li>
        </ul>
      </Container>
    </Box>
  ) 
}

export default Reports;
