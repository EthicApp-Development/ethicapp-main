import React from 'react';
import { Link } from 'react-router-dom';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import Container from '@mui/material/Container';
import { Grid, Typography, Divider } from '@mui/material';
import DescriptionIcon from '@mui/icons-material/Description';

function Reports() {

  const gridData = [
    { icon: <DescriptionIcon fontSize="large" />, text: 'Report 1' },
    { icon: <DescriptionIcon fontSize="large" />, text: 'Report 2' },
    { icon: <DescriptionIcon fontSize="large" />, text: 'Report 3' },
    { icon: <DescriptionIcon fontSize="large" />, text: 'Report 4' },
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
            Report Generation
          </Typography>
          <Typography variant="h6" gutterBottom>
            From here you can choose which report to generate using the data currently stored by Ethicapp.
          </Typography>
        <br/>
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <Divider variant="fullWidth" />
          </Grid>
          {gridData.map((item, index) => (
            <Grid item xs={12} sm={6} md={4} lg={3} key={index}>
              <Box display="flex" alignItems="center" border="1px solid black" padding={2} backgroundColor="lightGrey">
                <Box marginRight={2}>{item.icon}</Box>
                <Typography variant="body1">{item.text}</Typography>
              </Box>
            </Grid>
          ))}
          <Grid item xs={12}>
            <Divider variant="fullWidth" />
          </Grid>
        </Grid>
        <Box mt={4}>
          <Typography variant="h5">Report Information</Typography>
          <Box p={2} border="1px solid #ccc" backgroundColor="lightGrey">
            insert the information of each report being dictated by the mouse over each item in the upper grid 
          </Box>
        </Box>
      </Container>
    </Box>
  ) 
}

export default Reports;
