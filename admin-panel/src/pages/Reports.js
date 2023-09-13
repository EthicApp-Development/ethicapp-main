import React, { useState } from 'react';

//Components
import { Grid, Container, Divider } from '@mui/material';
import BoxGrid from '../components/BoxGrid';
import ReportDescriptionBox from '../components/ReportDescriptionBox';
import PageBase from '../components/PageBase';
import HeaderNSubHeader from '../components/HeaderNSubHeader';

//Icons
import DescriptionIcon from '@mui/icons-material/Description';

function Reports(props) {
  const translation = props.translation;

  const pageTitle= translation("reports.title");
  const pageSubTitle= translation("reports.subTitle");

  const gridData = [
    { icon: <DescriptionIcon fontSize="large" />, text: translation("reports.start_activity"), reportType:"start_activity", link:"/admin/report/start_activity" },
    { icon: <DescriptionIcon fontSize="large" />, text: translation("reports.create_account"), reportType:"create_account", link:"/admin/report/create_account",},
    { icon: <DescriptionIcon fontSize="large" />, text: translation("reports.logins"), reportType:"logins", link:"/admin/report/logins",},
    { icon: <DescriptionIcon fontSize="large" />, text: translation("reports.top_professors"), reportType:"top_professors", link:"/admin/report/top_professors",},
    // Add more data as needed
  ];

  const [hoveredItem, setHoveredItem] = useState('');
  const [reportDescriptionBoxText, setReportDescriptionBoxText] = useState('');
  const [showReportDescription, setShowReportDescription] = useState(false);

  const handleHoverStart = (reportType) => {
    setHoveredItem(reportType);
    setReportDescriptionBoxText(translation(`reports.${reportType}_desc`));
    setShowReportDescription(true);
  };

  return(
    <PageBase children={
      <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
        <HeaderNSubHeader title={pageTitle} subTitle={pageSubTitle}/>
        <br/>

        <BoxGrid gridData={gridData} handleMouseOver={handleHoverStart} />

        <ReportDescriptionBox text={reportDescriptionBoxText} visibility={showReportDescription} translation={translation}/>
      </Container>
    }/>
  ) 
}

export default Reports;
