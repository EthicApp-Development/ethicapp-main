import React from 'react';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import Container from '@mui/material/Container';

function Users() {
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
        <h2>Users Page</h2>
        <h2>Show all the user related actions</h2>
      </Container>
    </Box>
  );
}

export default Users;
