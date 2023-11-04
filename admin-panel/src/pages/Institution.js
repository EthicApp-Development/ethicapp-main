import React, {useEffect, useState} from 'react';

//Components
import Container from '@mui/material/Container';
import PageBase from '../components/PageBase';
import InstitutionForm from '../components/InstitutionForm';
import { GetInstitutionForm, UpdateInstitutionForm, UploadInstitutionImage} from '../components/APICommunication';
import Toast from '../components/Toast';



function Institution(props) {

  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastSeverity, setToastSeverity] = useState(0);

  const handleCloseToast = (event, reason) => {
    if (reason === 'clickaway') {
      return;
    }
  
    setShowToast(false);
  };

  const translation = props.translation;

  const [formData, setFormData] = useState({
      institution_name: "",
      institution_url: "",
      ethicapp_url: "",
      physical_address: "",
      institution_logo: "",
      institution_it_email: "",
      institution_educational_email: ""
  });
  
  useEffect(() => {
    GetInstitutionForm()
      .then((response) => {
        setFormData(response.data)
      })
      .catch((error) => {
        console.error('Error fetching items:', error);
      });
  }, []);

    const handleInputChange = (e) => {
      const { name, value } = e.target;
      setFormData({
        ...formData,
        [name]: value,
      });
    };
  
    const handleFileChange = (e) => {
      setFormData({
        ...formData,
        file: e.target.files[0],
      });
    };

    const isEmailValid = (email) => {
      // Regular expression for a simple email format validation
      if (!isNaN(email.length)) {
        return false;
      }
      const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4}$/;
      return emailRegex.test(email);
    };

    const handleSubmit = (e) => {
      e.preventDefault();
      if (!isEmailValid(formData.institution_it_email)) {
        return;
      }
      if (!isEmailValid(formData.institution_educational_email)) {
        return;
      }

      if (formData.file === undefined) {
        UpdateInstitutionForm(formData)
        .then((response) => {
          if (response.status === 200) {
            setToastMessage(translation("institution.success"));
            setToastSeverity(1)
          } else {
            setToastMessage(translation("institution.error"));
            setToastSeverity(0)
          }
          setShowToast(true);
        })
        .catch((error) => {
          console.error('Error updating form:', error);
          setToastMessage(translation("institution.error"));
          setToastSeverity(0)
          setShowToast(true);
        });
      } else {
        const formDataFileAux = new FormData();
        formDataFileAux.append('file', formData.file);

        UploadInstitutionImage(formDataFileAux)
        .then((response) => {

          setFormData((formData) => ({
            ...formData,
            institution_logo: response.data["filename"],
          }));

          UpdateInstitutionForm(formData)
          .then((response) => {
            if (response.status === 200) {
              setToastMessage(translation("institution.success"));
              setToastSeverity(1)
            } else {
              setToastMessage(translation("institution.error"));
              setToastSeverity(0)
            }
            setShowToast(true);
          })
          .catch((error) => {
            console.error('Error updating form:', error);
            setToastMessage(translation("institution.error"));
            setToastSeverity(0)
            setShowToast(true);
          });

        })
        .catch((error) => {
          console.error('Error updating form:', error);
          setToastMessage(translation("institution.error"));
          setToastSeverity(0)
          setShowToast(true);
        });
      }
    };

  return(
    <PageBase children={
      <Container  maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        <InstitutionForm 
        formData={formData} 
        handleSubmit={handleSubmit} 
        handleInputChange={handleInputChange}
        isEmailValid={isEmailValid}
        handleFileChange={handleFileChange}
        translation={translation}
        />
        <Toast open={showToast} message={toastMessage} onClose={handleCloseToast} severity={toastSeverity} />
    </Container>
    }/>
  );
}

export default Institution;
