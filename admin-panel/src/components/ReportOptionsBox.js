import { Paper, Grid, Radio, RadioGroup, FormControlLabel, TextField, Button, FormControl, FormLabel, Typography, Box } from '@mui/material';

const ReportOptionsBox = (props) =>{

    const handleSubmit = props.handleSubmit;

    return <Grid item xs={12} md={6}>
        <Paper elevation={3} style={{ height: '100%' }}>
        <form onSubmit={handleSubmit}>
            <Box p={3}>
            <Typography variant="h5" gutterBottom>
                Report Options
            </Typography>
            <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} md={6}>
                <FormControl component="fieldset">
                    <FormLabel component="legend">Select an option:</FormLabel>
                    <RadioGroup row aria-label="report-option" name="reportOption">
                    <FormControlLabel value="option1" control={<Radio />} label="1 Month" />
                    <FormControlLabel value="option2" control={<Radio />} label="3 Month" />
                    <FormControlLabel value="option3" control={<Radio />} label="6 Month" />
                    <FormControlLabel value="option4" control={<Radio />} label="12 Month" />
                    <FormControlLabel value="option5" control={<Radio />} label="Custom Date Range" />
                    </RadioGroup>
                </FormControl>
                </Grid>
                <Grid item xs={6} md={3}>
                <TextField
                    id="start-date"
                    label="Start Date"
                    type="date"
                    fullWidth
                    InputLabelProps={{
                    shrink: true,
                    }}
                />
                </Grid>
                <Grid item xs={6} md={3}>
                <TextField
                    id="end-date"
                    label="End Date"
                    type="date"
                    fullWidth
                    InputLabelProps={{
                    shrink: true,
                    }}
                />
                </Grid>
            </Grid>
            <br/>
            <Button type="submit" variant="contained" color="primary">
                Generate Report
            </Button>
            </Box>
        </form>
        </Paper>
    </Grid>

}

export default ReportOptionsBox;