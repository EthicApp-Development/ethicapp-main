import HeaderNSubHeader from '../components/HeaderNSubHeader';
import { TextField, Button, Paper, Grid, Divider, Box } from '@mui/material';

//Icons
import { CloudUpload } from '@mui/icons-material';



const InstitutionForm = (props) =>{

    const handleSubmit = props.handleSubmit;
    const formData = props.formData;
    const handleInputChange = props.handleInputChange
    const isEmailValid = props.isEmailValid
    const handleFileChange = props.handleFileChange

    const translation = props.translation;

    const pageTitle= translation("institutionForm.title");
    const pageSubTitle= translation("institutionForm.subTitle")

    return <Paper elevation={3}>
        <Box p={3}>
            <HeaderNSubHeader title={pageTitle} subTitle={pageSubTitle}/>

            <br/>

            <form onSubmit={handleSubmit} encType="multipart/form-data">
                <Grid container spacing={3}>
                    <Grid item xs={12}>
                        <Divider variant="fullWidth" />
                    </Grid>
                    <Grid item xs={12}>
                        <TextField
                        label={translation("institutionForm.institution_name")}
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
                        label={translation("institutionForm.physical_address")}
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
                        label={translation("institutionForm.institution_url")}
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
                        label={translation("institutionForm.ethicapp_url")}
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
                        label={translation("institutionForm.institution_it_email")}
                        fullWidth
                        variant="outlined"
                        name="institution_it_email"
                        value={formData.institution_it_email}
                        onChange={handleInputChange}
                        required
                        error={!isEmailValid(formData.institution_it_email)}
                        helperText={
                            !isEmailValid(formData.institution_it_email) && translation("institutionForm.email_error")
                        }
                        />
                    </Grid>
                    <Grid item xs={12}>
                        <TextField
                        label={translation("institutionForm.institution_educational_email")}
                        fullWidth
                        variant="outlined"
                        name="institution_educational_email"
                        value={formData.institution_educational_email}
                        onChange={handleInputChange}
                        required
                        error={!isEmailValid(formData.institution_educational_email)}
                        helperText={
                            !isEmailValid(formData.institution_educational_email) && translation("institutionForm.email_error")
                        }
                        />
                    </Grid>

                    <Grid item xs={12}>
                        <Divider variant="fullWidth" />
                    </Grid>

                    <Grid item xs={12}>
                        <input
                        accept="image/png"
                        style={{ display: 'none' }}
                        id="file-upload"
                        type="file"
                        name="file"
                        onChange={handleFileChange}
                        />
                        <label htmlFor="file-upload">
                        <Button
                            variant="contained"
                            component="span"
                            startIcon={<CloudUpload />}
                        >
                            {translation("institutionForm.file-upload")}
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
                                {translation("institutionForm.submit")}
                        </Button>
                    </Grid>
                </Grid>
            </form>
        </Box>
    </Paper>
}

export default InstitutionForm;