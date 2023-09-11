import React, { useState } from 'react';
import {useParams} from 'react-router-dom';
import { Line } from 'react-chartjs-2';
import { Chart, registerables } from 'chart.js';
import Toolbar from '@mui/material/Toolbar';
import { Container, Paper, Grid, Radio, RadioGroup, FormControlLabel, TextField, Button, FormControl, FormLabel, Typography, Box, IconButton, Hidden } from '@mui/material';
import { SaveAlt as SaveAltIcon } from '@mui/icons-material';


Chart.register(...registerables);

function SingleReport() {

  const {reportEnum} = useParams();
  const [showSecondBox, setShowSecondBox] = useState(false);

  const data = {
    labels: ['January', 'February', 'March', 'April', 'May'],
    datasets: [
      {
        label: 'Sample Line Chart',
        data: [12, 19, 3, 5, 2],
        fill: false,
        borderColor: 'rgba(75,192,192,1)',
        borderWidth: 2,
      },
    ],
  };

  // Chart configuration options
  const options = {
    scales: {
      y: {
        beginAtZero: true,
      },
    },
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // Implement report generation logic here
    // After generating the report, show the second box
    setShowSecondBox(true);
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
            Insert information about the specific reports that is being generated.
          </Typography>
        <br/>
        {/* First Box */}
        <Grid item xs={12} md={6}>
          <Paper elevation={3} style={{ height: '100%' }}>
            <form onSubmit={handleSubmit}>
              <Box p={3}>
                <Typography variant="h5" gutterBottom>
                  Report Options
                </Typography>
                <Grid container spacing={2} alignItems="center">
                  <Grid item xs={12} md={6}>
                    <FormControl component="fieldset">
                      <FormLabel component="legend">Select an option:</FormLabel>
                      <RadioGroup row aria-label="report-option" name="reportOption">
                        <FormControlLabel value="option1" control={<Radio />} label="1 Month" />
                        <FormControlLabel value="option2" control={<Radio />} label="3 Month" />
                        <FormControlLabel value="option3" control={<Radio />} label="6 Month" />
                        <FormControlLabel value="option4" control={<Radio />} label="12 Month" />
                        <FormControlLabel value="option5" control={<Radio />} label="Custom Date Range" />
                      </RadioGroup>
                    </FormControl>
                  </Grid>
                  <Grid item xs={6} md={3}>
                    <TextField
                      id="start-date"
                      label="Start Date"
                      type="date"
                      fullWidth
                      InputLabelProps={{
                        shrink: true,
                      }}
                    />
                  </Grid>
                  <Grid item xs={6} md={3}>
                    <TextField
                      id="end-date"
                      label="End Date"
                      type="date"
                      fullWidth
                      InputLabelProps={{
                        shrink: true,
                      }}
                    />
                  </Grid>
                </Grid>
                <br/>
                <Button type="submit" variant="contained" color="primary">
                  Generate Report
                </Button>
              </Box>
            </form>
          </Paper>
        </Grid>

        <br/>

        {/* Second Box */}
        {showSecondBox && (
          <Grid item xs={12} md={6}>
            <Paper elevation={3} style={{ height: '100%' }}>
              <Box p={3}>
                <IconButton color="primary" component="a">
                  <SaveAltIcon />
                  Download
                </IconButton>
                <div style={{ width: 'auto', height: 'auto', alignContent: 'center'}}>
                  <Line data={data} options={options} />
                </div>
              </Box>
            </Paper>
          </Grid>
        )}
      </Container>
    </Box>
  ) 
}

export default SingleReport;
