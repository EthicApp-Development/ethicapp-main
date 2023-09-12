import React, { useState } from 'react';

//Components
import { Grid, Container, Divider } from '@mui/material';
import BoxGrid from '../components/BoxGrid';
import ReportDescriptionBox from '../components/ReportDescriptionBox';
import PageBase from '../components/PageBase';
import HeaderNSubHeader from '../components/HeaderNSubHeader';

//Icons
import DescriptionIcon from '@mui/icons-material/Description';

const pageTitle= "Report Generation";
const pageSubTitle="From here you can choose which report to generate using the data currently stored by Ethicapp."

function Reports() {

  const gridData = [
    { icon: <DescriptionIcon fontSize="large" />, text: 'Started Activities', reportType:"start_activity", link:"/admin/report/start_activity" },
    { icon: <DescriptionIcon fontSize="large" />, text: 'Accounts Created', reportType:"create_account", link:"/admin/report/create_account",},
    { icon: <DescriptionIcon fontSize="large" />, text: 'Ethicapp Logins', reportType:"logins", link:"/admin/report/logins",},
    { icon: <DescriptionIcon fontSize="large" />, text: 'Top Activity Starting Professors ', reportType:"top_professors", link:"/admin/report/top_professors",},
    // Add more data as needed
  ];

  const [hoveredItem, setHoveredItem] = useState('');
  const [reportDescriptionBoxText, setReportDescriptionBoxText] = useState('');
  const [showReportDescription, setShowReportDescription] = useState(false);

  const handleHoverStart = (reportType) => {
    setHoveredItem(reportType);
    setReportDescriptionBoxText("Information about the report of type: "+reportType);
    setShowReportDescription(true);
    console.log(`Hover started on ${reportType}`);
  };

  return(
    <PageBase children={
      <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
        <HeaderNSubHeader title={pageTitle} subTitle={pageSubTitle}/>
        <br/>

        <BoxGrid gridData={gridData} handleMouseOver={handleHoverStart} />

        <ReportDescriptionBox text={reportDescriptionBoxText} visibility={showReportDescription}/>
      </Container>
    }/>
  ) 
}

export default Reports;
