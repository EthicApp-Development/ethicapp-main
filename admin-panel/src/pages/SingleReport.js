import React, { useState } from 'react';
import {useParams} from 'react-router-dom';

//Components
import PageBase from '../components/PageBase';
import HeaderNSubHeader from '../components/HeaderNSubHeader';
import ReportOptionsBox from '../components/ReportOptionsBox';
import ReportGraphBox from '../components/ReportGraphBox';
import { Chart, registerables } from 'chart.js';
import { Container } from '@mui/material';

Chart.register(...registerables);

function SingleReport(props) {

  const {reportEnum} = useParams();
  const translation = props.translation;

  const pageTitle= translation(`singleReport.${reportEnum}_title`);
  const pageSubTitle= translation("singleReport.subTitle")

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
    <PageBase children={
      <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
        <HeaderNSubHeader title={pageTitle} subTitle={pageSubTitle}/>
        <br/>
        <ReportOptionsBox handleSubmit={handleSubmit} translation={translation}/>
        <br/>
        <ReportGraphBox data={data} options={options} visibility={showSecondBox} translation={translation}/>
      </Container>
    }/>
  ) 
}

export default SingleReport;
