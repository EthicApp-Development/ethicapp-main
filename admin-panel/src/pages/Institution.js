import React, {useState} from 'react';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import Container from '@mui/material/Container';
import {
  TextField,
  Button,
  Typography,
  Paper,
  Grid,
  Divider
} from '@mui/material';
import { CloudUpload } from '@mui/icons-material';

function Institution() {

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
    <Box
      component="main"
      sx={{
        backgroundColor: (theme) =>
          theme.palette.mode === 'light'
            ? theme.palette.grey[100]
            : theme.palette.grey[900],
        flexGrow: 1,
        height: '100vh',
        overflow: 'auto',
      }}
    >
      <Toolbar />
      <Container  maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Paper elevation={3}>
        <Box p={3}>
          <Typography variant="h4" gutterBottom>
            Institution Data
          </Typography>
          <Typography variant="h6" gutterBottom>
            From here you can update the data of the institution for which EthicApp operates.
          </Typography>
          <br/>
          <form onSubmit={handleSubmit}>
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <Divider variant="fullWidth" />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label="Institution Name"
                  fullWidth
                  variant="outlined"
                  name="institution_name"
                  value={formData.institution_name}
                  onChange={handleInputChange}
                  required
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label="Physical Address"
                  fullWidth
                  variant="outlined"
                  name="physical_address"
                  value={formData.physical_address}
                  onChange={handleInputChange}
                  required
                />
              </Grid>
              <Grid item xs={12}>
                <Divider variant="fullWidth" />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label="Institution Url"
                  fullWidth
                  variant="outlined"
                  name="institution_url"
                  value={formData.institution_url}
                  onChange={handleInputChange}
                  required
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label="Ethicapp Url"
                  fullWidth
                  variant="outlined"
                  name="ethicapp_url"
                  value={formData.ethicapp_url}
                  onChange={handleInputChange}
                  required
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label="Institution IT Email"
                  fullWidth
                  variant="outlined"
                  name="institution_it_email"
                  value={formData.institution_it_email}
                  onChange={handleInputChange}
                  required
                  error={!isEmailValid(formData.institution_it_email) && formData.institution_it_email.length > 0}
                  helperText={
                    !isEmailValid(formData.institution_it_email) && 'Please enter a valid email address.'
                  }
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label="Institution Educational Email"
                  fullWidth
                  variant="outlined"
                  name="institution_educational_email"
                  value={formData.institution_educational_email}
                  onChange={handleInputChange}
                  required
                  error={!isEmailValid(formData.institution_educational_email) && formData.institution_educational_email.length > 0}
                  helperText={
                    !isEmailValid(formData.institution_educational_email) && 'Please enter a valid email address.'
                  }
                />
              </Grid>
              <Grid item xs={12}>
                <Divider variant="fullWidth" />
              </Grid>
              <Grid item xs={12}>
                <input
                  accept="image/*"
                  style={{ display: 'none' }}
                  id="file-upload"
                  type="file"
                  onChange={handleFileChange}
                />
                <label htmlFor="file-upload">
                  <Button
                    variant="contained"
                    component="span"
                    startIcon={<CloudUpload />}
                  >
                    Upload Institution Logo
                  </Button>
                </label>
                {formData.file && <span> {formData.file.name}</span>}
              </Grid>
              <Grid item xs={12}>
                <Button
                  type="submit"
                  variant="contained"
                  color="primary"
                  fullWidth
                >
                  Submit
                </Button>
              </Grid>
            </Grid>
          </form>
        </Box>
      </Paper>
    </Container>
    </Box>
  );
}

export default Institution;
