import { Paper, Grid, Radio, RadioGroup, FormControlLabel, TextField, Button, FormControl, FormLabel, Typography, Box } from '@mui/material';

const ReportOptionsBox = (props) =>{

    const translation = props.translation;
    const handleSubmit = props.handleSubmit;
    const handleChange = props.handleChange;
    const formStartDateValue = props.formStartDateValue;
    const formEndDateValue = props.formEndDateValue;
    const selectedOption = props.selectedOption;

    return <Grid item xs={12} md={6}>
        <Paper elevation={3} style={{ height: '100%' }}>
            <form onSubmit={handleSubmit}>
                <Box p={3}>
                    <Typography variant="h5" gutterBottom>
                    {translation("ReportOptionsBox.title")}
                    </Typography>
                    <Grid container spacing={2} alignItems="center">
                    <Grid item xs={12} md={6}>
                        <FormControl component="fieldset" required>
                        <FormLabel component="legend">
                            {translation("ReportOptionsBox.selectOption")}
                        </FormLabel>
                        <RadioGroup
                            row
                            aria-label="report-option"
                            name="reportOption"
                            onChange={handleChange}
                            value={selectedOption}
                            required
                        >
                            <FormControlLabel
                            value="option1"
                            control={<Radio />}
                            label={translation("ReportOptionsBox.option1")}
                            />
                            <FormControlLabel
                            value="option2"
                            control={<Radio />}
                            label={translation("ReportOptionsBox.option2")}
                            />
                            <FormControlLabel
                            value="option3"
                            control={<Radio />}
                            label={translation("ReportOptionsBox.option3")}
                            />
                            <FormControlLabel
                            value="option4"
                            control={<Radio />}
                            label={translation("ReportOptionsBox.option4")}
                            />
                            <FormControlLabel
                            value="option5"
                            control={<Radio />}
                            label={translation("ReportOptionsBox.option5")}
                            />
                        </RadioGroup>
                        </FormControl>
                    </Grid>
                    <Grid item xs={6} md={3}>
                        <TextField
                        id="start-date"
                        name="startDate"
                        label={translation("ReportOptionsBox.startDate")}
                        type="date"
                        fullWidth
                        value={formStartDateValue}
                        InputLabelProps={{
                            shrink: true,
                        }}
                        onChange={handleChange}
                        />
                    </Grid>
                    <Grid item xs={6} md={3}>
                        <TextField
                        id="end-date"
                        name="endDate"
                        label={translation("ReportOptionsBox.endDate")}
                        type="date"
                        fullWidth
                        value={formEndDateValue}
                        InputLabelProps={{
                            shrink: true,
                        }}
                        onChange={handleChange}
                        />
                    </Grid>
                    </Grid>
                    <br />
                    <Button type="submit" variant="contained" color="primary" style={{textTransform:"none"}}>
                    {translation("ReportOptionsBox.generateReport")}
                    </Button>
                </Box>
            </form>
        </Paper>
    </Grid>

}

export default ReportOptionsBox;