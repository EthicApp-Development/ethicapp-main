import React, {useState} from 'react';

//Components
import Container from '@mui/material/Container';
import PageBase from '../components/PageBase';
import InstitutionForm from '../components/InstitutionForm';

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
      // Handle form submission here, e.g., send data to a server
      console.log(formData);
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
