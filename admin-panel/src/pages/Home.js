import React from 'react';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import Container from '@mui/material/Container';

function Home() {
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
        <h2>Admin Home</h2>
        <h2>Show general admin panel info here</h2>
      </Container>
    </Box>
  );
}

export default Home;
