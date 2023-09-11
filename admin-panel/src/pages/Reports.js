import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import Container from '@mui/material/Container';
import { Grid, Typography, Divider, styled } from '@mui/material';
import DescriptionIcon from '@mui/icons-material/Description';

// Override link styles
const StyledLink = styled(Link)`
  text-decoration: none;
  color: inherit; /* Inherit text color from parent */
`;

function Reports() {

  const gridData = [
    { icon: <DescriptionIcon fontSize="large" />, text: 'Started Activities', reportType:"start_activity", },
    { icon: <DescriptionIcon fontSize="large" />, text: 'Accounts Created', reportType:"create_account",},
    { icon: <DescriptionIcon fontSize="large" />, text: 'Ethicapp Logins', reportType:"logins",},
    { icon: <DescriptionIcon fontSize="large" />, text: 'Top Activity Starting Professors ', reportType:"top_professors",},
    // Add more data as needed
  ];

  const [hoveredItem, setHoveredItem] = useState('');
  const [reportDescriptionBoxText, setReportDescriptionBoxText] = useState('Insert the information of each report being dictated by the mouse over each item in the upper grid. ');

  const handleHoverStart = (reportType) => {
    setHoveredItem(reportType);
    setReportDescriptionBoxText("Information about the report of type: "+reportType)
    console.log(`Hover started on ${reportType}`);
  };

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
              <StyledLink to={`/admin/report/${item.reportType}`} style={{ textDecoration: 'none' }}>
                <Box display="flex" alignItems="center" border="1px solid black" padding={2} backgroundColor="lightGrey" onMouseEnter={() => handleHoverStart(item.reportType)}>
                  <Box marginRight={2}>{item.icon}</Box>
                  <Typography variant="body1">{item.text}</Typography>
                </Box>
              </StyledLink>
            </Grid>
          ))}
          <Grid item xs={12}>
            <Divider variant="fullWidth" />
          </Grid>
        </Grid>
        <Box mt={4}>
          <Typography variant="h5">Report Information</Typography>
          <Box p={2} border="1px solid #ccc" backgroundColor="lightGrey">
            {reportDescriptionBoxText} 
          </Box>
        </Box>
      </Container>
    </Box>
  ) 
}

export default Reports;
