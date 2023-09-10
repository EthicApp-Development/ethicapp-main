import React, {useState} from 'react';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import Container from '@mui/material/Container';

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

    // Function to handle form input changes
    const handleInputChange = (e) => {
      const { name, value } = e.target;
      setFormData({
        ...formData,
        [name]: value,
      });
    };

    // Function to handle form submission
    const handleSubmit = (e) => {
      e.preventDefault();
      // You can access the form data in formData state here and perform any desired actions, e.g., sending it to a server.
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
      <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
        <h2>Institution Page</h2>
        <h2>Show all the textfield of the current institution</h2>

        <form onSubmit={handleSubmit}>
          {/* institution_name Field */}
          <label htmlFor="institution_name">Institution Name:</label>
          <input
            type="text"
            id="institution_name"
            name="institution_name"
            value={formData.institution_name}
            onChange={handleInputChange}
            required
          />
          <br />

          {/* institution_url Field */}
          <label htmlFor="institution_url">Institution Url:</label>
          <input
            type="text"
            id="institution_url"
            name="institution_url"
            value={formData.institution_url}
            onChange={handleInputChange}
            required
          />
          <br />

          {/* ethicapp_url Field */}
          <label htmlFor="ethicapp_url">Ethicapp Url:</label>
          <input
            type="text"
            id="ethicapp_url"
            name="ethicapp_url"
            value={formData.ethicapp_url}
            onChange={handleInputChange}
            required
          />
          <br />

          {/* physical_address Field */}
          <label htmlFor="physical_address">Physical Address:</label>
          <input
            type="text"
            id="physical_address"
            name="physical_address"
            value={formData.physical_address}
            onChange={handleInputChange}
            required
          />
          <br />

          {/* institution_logo Field */}
          <label htmlFor="institution_logo">Institution Logo:</label>
          <input
            type="text"
            id="institution_logo"
            name="institution_logo"
            value={formData.institution_logo}
            onChange={handleInputChange}
            required
          />
          <br />

          {/* institution_it_email Field */}
          <label htmlFor="institution_it_email">Institution It Email:</label>
          <input
            type="email"
            id="institution_it_email"
            name="institution_it_email"
            value={formData.institution_it_email}
            onChange={handleInputChange}
            required
          />
          <br />

          {/* institution_educational_email Field */}
          <label htmlFor="institution_it_email">Institution Educational Email:</label>
          <input
            type="email"
            id="institution_educational_email"
            name="institution_educational_email"
            value={formData.institution_educational_email}
            onChange={handleInputChange}
            required
          />
          <br />

          {/* Submit Button */}
          <button type="submit">Submit</button>
        </form>
      </Container>
    </Box>
  );
}

export default Institution;
