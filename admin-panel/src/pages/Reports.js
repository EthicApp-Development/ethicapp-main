import React, { useEffect, useState } from 'react';

//Components
import { Container } from '@mui/material';
import BoxGrid from '../components/BoxGrid';
import ReportDescriptionBox from '../components/ReportDescriptionBox';
import PageBase from '../components/PageBase';
import HeaderNSubHeader from '../components/HeaderNSubHeader';
import { GetReports } from '../components/APICommunication';

//Icons
import DescriptionIcon from '@mui/icons-material/Description';

function Reports(props) {
  const translation = props.translation;
  useEffect(() => {
    GetReports()
      .then((response) => {
        let gridData = []
        response.data["reports"].forEach(element => {
          gridData.push({ 
            icon: <DescriptionIcon fontSize="large" />, 
            text: translation(`reports.${element}`), 
            reportType:element,  
            link:`/admin/report/${element}` })
        });
        setGridDataFinal(gridData)
      })
      .catch((error) => {
        console.error('Error fetching items:', error);
      });
  });

  const pageTitle= translation("reports.title");
  const pageSubTitle= translation("reports.subTitle");

  const [hoveredItem, setHoveredItem] = useState('');
  const [gridDataFinal, setGridDataFinal] = useState([]);
  const [reportDescriptionBoxText, setReportDescriptionBoxText] = useState('');
  const [showReportDescription, setShowReportDescription] = useState(false);

  const handleHoverStart = (reportType) => {
    console.log(hoveredItem);
    setHoveredItem(reportType);
    setReportDescriptionBoxText(translation(`reports.${reportType}_desc`));
    setShowReportDescription(true);
  };

  return(
    <PageBase children={
      <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
        <HeaderNSubHeader title={pageTitle} subTitle={pageSubTitle}/>
        <br/>

        <BoxGrid gridData={gridDataFinal} handleMouseOver={handleHoverStart} />

        <ReportDescriptionBox text={reportDescriptionBoxText} visibility={showReportDescription} translation={translation}/>
      </Container>
    }/>
  ) 
}

export default Reports;
