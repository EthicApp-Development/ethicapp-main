import HeaderNSubHeader from '../components/HeaderNSubHeader';
import { TextField, Button, Paper, Grid, Divider, Box } from '@mui/material';

//Icons
import { CloudUpload } from '@mui/icons-material';

const pageTitle= "Institution Data";
const pageSubTitle="From here you can update the data of the institution for which EthicApp operates."

const InstitutionForm = (props) =>{

    const handleSubmit = props.handleSubmit;
    const formData = props.formData;
    const handleInputChange = props.handleInputChange
    const isEmailValid = props.isEmailValid
    const handleFileChange = props.handleFileChange

    return <Paper elevation={3}>
        <Box p={3}>
            <HeaderNSubHeader title={pageTitle} subTitle={pageSubTitle}/>

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
                        label="Institution URL"
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
                        label="Ethicapp URL"
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
                        label="Technical Contact"
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
                        label="Educational Contact"
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
                        <Divider variant="fullWidth" />
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
}

export default InstitutionForm;