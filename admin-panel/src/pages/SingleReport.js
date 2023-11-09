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
  const [formStartDateValue, setFormStartDateValue] = useState("");
  const [formEndDateValue, setFormEndDateValue] = useState("");
  const [selectedOption, setSelectedOption] = useState(""); 

  const getCurrentDate = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = (today.getMonth() + 1).toString().padStart(2, '0');
    const day = today.getDate().toString().padStart(2, '0');
    const formattedDate = `${year}-${month}-${day}`;
    setFormEndDateValue(formattedDate);
  };

  const calculatePreviousDate = (monthsToSubtract) => {
    const today = new Date();
    const previousDate = new Date(today);
    previousDate.setMonth(today.getMonth() - monthsToSubtract);

    const year = previousDate.getFullYear();
    const month = (previousDate.getMonth() + 1).toString().padStart(2, '0');
    const day = previousDate.getDate().toString().padStart(2, '0');
    const formattedPreviousDate = `${year}-${month}-${day}`;

    setFormStartDateValue(formattedPreviousDate);
  };

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

    var startDateAuxCheck = new Date(formData.startDate);
    var endDateAuxCheck = new Date(formData.endDate);

    if (formData.reportOption === 'option5' && (formData.startDate==='' || formData.endDate==='')) {
      setToastMessage(translation(`singleReport.formErrorDates`));
      setShowToast(true);
      return;
    }

    if (formData.reportOption === 'option5' && endDateAuxCheck<startDateAuxCheck) {
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

    if (name==="startDate" || name==="endDate" ) {
      if (name==="startDate") {
        setFormStartDateValue(value)
      } else {
        setFormEndDateValue(value)
      }
      setSelectedOption("option5")

      setFormData((prevFormData) => ({
        ...prevFormData,
        reportOption: "option5",
      }));
    }else{

      getCurrentDate();
      setSelectedOption(value)

      if (value==="option1") {
        calculatePreviousDate(1);
      }
      if (value==="option2") {
        calculatePreviousDate(3);
      }
      if (value==="option3") {
        calculatePreviousDate(6);
      }
      if (value==="option4") {
        calculatePreviousDate(12);
      }
      if (value==="option5") {
        setFormStartDateValue("")
        setFormEndDateValue("")
      }
    }
  };

  return(
    <PageBase children={
      <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
        <HeaderNSubHeader title={pageTitle} subTitle={pageSubTitle}/>
        <br/>
        <ReportOptionsBox handleSubmit={handleSubmit} translation={translation} handleChange={handleChange} 
        formStartDateValue={formStartDateValue} formEndDateValue={formEndDateValue} selectedOption={selectedOption}/>
        <br/>
        <ReportGraphBox graph={graphElement} visibility={showSecondBox} translation={translation} downloadTitle={translation(`reports.${reportEnum}`)}/>
        <Toast open={showToast} message={toastMessage} onClose={handleCloseToast} severity={0} />
      </Container>
    }/>
  ) 
}

export default SingleReport;
