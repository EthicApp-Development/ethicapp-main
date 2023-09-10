import React from 'react';
import {useParams} from 'react-router-dom';
import { Line } from 'react-chartjs-2';
import { Chart, registerables } from 'chart.js';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import Container from '@mui/material/Container';


Chart.register(...registerables);

function SingleReport() {

  const {reportEnum} = useParams();

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
        <h2>Report Page for {reportEnum}</h2>
        <h2>Show the report basic info here and the query the data with the given parameters</h2>
        <div style={{ width: '600px', height: '600px' }}>
          <Line data={data} options={options} />
        </div>
      </Container>
    </Box>
  ) 
}

export default SingleReport;
