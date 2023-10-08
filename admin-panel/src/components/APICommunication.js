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

export const GetInstitutionForm = async () => {
  const response = await api.get(`/institution`);
    
  if (response.data) {
    const modifiedData = { ...response.data };
    delete modifiedData.id;
    response.data = modifiedData;
  }

  return response;
};

export const UpdateInstitutionForm= (postData) => {
  return api.put(`/institution`,postData);
};