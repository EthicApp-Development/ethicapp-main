import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import Container from '@mui/material/Container';
import { Grid, Typography, Divider, styled } from '@mui/material';
import SchoolIcon from '@mui/icons-material/School';
import PeopleIcon from '@mui/icons-material/People';
import BarChartIcon from '@mui/icons-material/BarChart';

// Override link styles
const StyledLink = styled(Link)`
  text-decoration: none;
  color: inherit; /* Inherit text color from parent */
`;

function Home() {

  const gridData = [
    { icon: <SchoolIcon fontSize="large" />, text: 'Update institutional data', link:"institution", },
    { icon: <PeopleIcon fontSize="large" />, text: 'See Reports', link:"reports", },
    { icon: <BarChartIcon fontSize="large" />, text: 'Administer Users', link:"users", },
    // Add more data as needed
  ];

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
          <Typography variant="h4" gutterBottom>
            Admin Home
          </Typography>
          <Typography variant="h6" gutterBottom>
            From here you can update the data of the institution for which EthicApp operates, review reports, and manage users..
          </Typography>
        <br/>
        <Grid container spacing={2}>
          {gridData.map((item, index) => (
            <Grid item xs={12} sm={6} md={4} lg={3} key={index}>
              <StyledLink to={`/admin/${item.link}`} style={{ textDecoration: 'none' }}>
                <Box display="flex" alignItems="center" border="1px solid black" padding={2}>
                  <Box marginRight={2}>{item.icon}</Box>
                  <Typography variant="body1">{item.text}</Typography>
                </Box>
              </StyledLink>
            </Grid>
          ))}
        </Grid>
      </Container>
    </Box>
  );
}

export default Home;
