import React, { useState } from 'react';
import {useParams} from 'react-router-dom';

//Components
import PageBase from '../components/PageBase';
import HeaderNSubHeader from '../components/HeaderNSubHeader';
import ReportOptionsBox from '../components/ReportOptionsBox';
import ReportGraphBox from '../components/ReportGraphBox';
import { Chart, registerables } from 'chart.js';
import { Container } from '@mui/material';
import { getReportGraphData } from '../components/APICommunication';

Chart.register(...registerables);

function SingleReport(props) {

  const {reportEnum} = useParams();
  const translation = props.translation;

  const pageTitle= translation(`singleReport.${reportEnum}_title`);
  const pageSubTitle= translation(`singleReport.${reportEnum}_desc`)
  const formError= translation(`singleReport.formError`)

  const [showSecondBox, setShowSecondBox] = useState(false);
  const [graphData, setGraphData] = useState({});
  const [formData, setFormData] = useState({
    reportOption: '',
    startDate: '',
    endDate: '',
  });

  let graphDataTemp = {
    labels: [],
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

    if (formData.reportOption === '' || (formData.reportOption === 'option5' && (formData.startDate==='' || formData.endDate===''))) {
      alert(formError);
      return;
    }
    const dateRange=GetDateRange(formData);

    getReportGraphData(reportEnum,dateRange).then((response) => {
      console.log(response.data)
      graphDataTemp["labels"]=response.data["report_x_data"]
      graphDataTemp["datasets"][0]["data"]=response.data["report_y1_data"]
      console.log(graphDataTemp)
      setGraphData(graphDataTemp)
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
        <ReportGraphBox data={graphData} options={options} visibility={showSecondBox} translation={translation}/>
      </Container>
    }/>
  ) 
}

function GetDateRange(formData){

  let endDate = formatDate(new Date());
  let initialDate = endDate;
  
 switch (formData.reportOption) {
  case "option1":
    initialDate = SubtractMonthsFromDate(1);
    break;
  
  case "option2":
    initialDate = SubtractMonthsFromDate(3);
    break;

  case "option3":
    initialDate = SubtractMonthsFromDate(6);
    break;

  case "option4":
    initialDate = SubtractMonthsFromDate(12);
    break;

  case "option5":
    endDate = formData.endDate;
    initialDate = formData.startDate;
    break;
 }
 
  return{
    "initialDate" : initialDate,
    "endDate" : endDate
  }
};

function SubtractMonthsFromDate(monthsToSubtract) {
  const newDate = new Date();
  newDate.setMonth(newDate.getMonth() - monthsToSubtract);
  return formatDate(newDate);
}

function formatDate(date) {
  const year = date.getFullYear().toString();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default SingleReport;
