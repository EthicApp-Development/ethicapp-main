import React, {useEffect, useState} from 'react';

//Components
import Container from '@mui/material/Container';
import PageBase from '../components/PageBase';
import InstitutionForm from '../components/InstitutionForm';
import { GetInstitutionForm, UpdateInstitutionForm, UploadInstitutionImage} from '../components/APICommunication';

function Institution(props) {

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
      try {
        const auxChecker = email.length;
      } catch (error) {
        return true;
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
            alert('Success: Form updated successfully');
          } else {
            alert('Error: Form update failed');
          }
        })
        .catch((error) => {
          console.error('Error updating form:', error);
          alert('Error: An error occurred while updating the form');
        });

      })
      .catch((error) => {
        console.error('Error updating form:', error);
        alert('Error: An error occurred while updating the form');
      });
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
    </Container>
    }/>
  );
}

export default Institution;
