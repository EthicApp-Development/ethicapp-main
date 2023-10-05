import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:5050',
});

export const getReports= () => {
  return api.get('/report');
};

export const getReportGraphData= (reportType, postData) => {
    return api.post(`/report/${reportType}`,postData);
  };