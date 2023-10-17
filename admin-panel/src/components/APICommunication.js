import axios from 'axios';

let api;

if (process.env.REACT_APP_DOMAIN==="localhost") {
  api = axios.create({
    baseURL: `http://${process.env.REACT_APP_DOMAIN}:${process.env.REACT_APP_API_PORT}`,
  });
} else {
  api = axios.create({
    baseURL: `http://${process.env.REACT_APP_DOMAIN}`,
  });
}

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

export const UploadInstitutionImage= (formData) => {
  return api.post('/upload-file-institution', formData, {
      headers: {
        'Content-Type': undefined,
      },
  });
};


export const ApiLogin= (postData) => {
  return api.post(`/login`,postData);
};

export const GetTeacherAccountRequests= () => {
  return api.get('/teacher_account_requests');
}

export const GetTeacherAccountRequest= (id) => {
  return api.get(`/teacher_account_requests/${id}`);
}

export const UpdateTeacherAccountRequest= (id, postData) => {
  return api.put(`/teacher_account_requests/${id}`,postData);
}
