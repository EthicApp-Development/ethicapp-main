import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:5050',
});

export const GetReports= () => {
  return api.get('/report');
};

export const GetReportGraphData= (reportType, postData) => {
    return api.post(`/report/${reportType}`,postData);
  };