import React, { useState } from 'react';
import {useParams} from 'react-router-dom';

//Components
import PageBase from '../components/PageBase';
import HeaderNSubHeader from '../components/HeaderNSubHeader';
import ReportOptionsBox from '../components/ReportOptionsBox';
import ReportGraphBox from '../components/ReportGraphBox';
import { Chart, registerables } from 'chart.js';
import { Container } from '@mui/material';
import { GetReportGraphData } from '../components/APICommunication';
import { GetDateRange, CreateGraph } from '../components/GraphDataParser';
import Toast from '../components/Toast';

Chart.register(...registerables);

function SingleReport(props) {
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  const {reportEnum} = useParams();
  const translation = props.translation;

  const pageTitle= translation(`singleReport.${reportEnum}_title`);
  const pageSubTitle= translation(`singleReport.${reportEnum}_desc`)

  const [showSecondBox, setShowSecondBox] = useState(false);
  const [graphElement, setGraphElement] = useState({});
  const [formData, setFormData] = useState({
    reportOption: '',
    startDate: '',
    endDate: '',
  });

  const handleCloseToast = (event, reason) => {
    if (reason === 'clickaway') {
      return;
    }

    setShowToast(false);
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (formData.reportOption === '') {
      setToastMessage(translation(`singleReport.formError`));
      setShowToast(true);
      return;
    }

    if (formData.reportOption === 'option5' && (formData.startDate==='' || formData.endDate==='')) {
      setToastMessage(translation(`singleReport.formErrorDates`));
      setShowToast(true);
      return;
    }

    const dateRange=GetDateRange(formData);

    GetReportGraphData(reportEnum,dateRange).then((response) => {
      setGraphElement(CreateGraph(response.data));
      setShowSecondBox(true);
    })
    .catch((error) => {
      console.error('Error fetching items:', error);
    });   
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: value,
    });
  };

  return(
    <PageBase children={
      <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
        <HeaderNSubHeader title={pageTitle} subTitle={pageSubTitle}/>
        <br/>
        <ReportOptionsBox handleSubmit={handleSubmit} translation={translation} handleChange={handleChange}/>
        <br/>
        <ReportGraphBox graph={graphElement} visibility={showSecondBox} translation={translation}/>
        <Toast open={showToast} message={toastMessage} onClose={handleCloseToast} severity={0} />
      </Container>
    }/>
  ) 
}

export default SingleReport;
