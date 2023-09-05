import React from 'react';
import {useParams} from 'react-router-dom';
import { Line } from 'react-chartjs-2';
import { Chart, registerables } from 'chart.js';

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
    <>
    <h2>Report Page for {reportEnum}</h2>
    <h2>Show the report basic info here and the query the data with the given parameters</h2>
    <div style={{ width: '600px', height: '600px' }}>
      <Line data={data} options={options} />
    </div>
    </>
  ) 
}

export default SingleReport;
