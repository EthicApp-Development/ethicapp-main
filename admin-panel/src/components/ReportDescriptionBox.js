import { Box, Typography, } from '@mui/material';

const ReportDescriptionBox = (props) =>{

    const reportDescriptionBoxText = props.text;
    const visibility = props.visibility;

    return<>         
        {visibility && (
            <Box mt={4}>
                <Typography variant="h5">Report Information</Typography>
                <Box p={2} border="1px solid #ccc" backgroundColor="lightGrey">
                {reportDescriptionBoxText} 
                </Box>
            </Box>
        )}
    </>
}

export default ReportDescriptionBox;