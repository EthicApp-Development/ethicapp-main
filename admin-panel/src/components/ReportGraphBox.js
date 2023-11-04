import React, { useRef } from 'react';
import { Paper, Grid, Box, IconButton, Tooltip } from '@mui/material';
import { SaveAlt as SaveAltIcon } from '@mui/icons-material';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

function formatDate() {
    const date = new Date();
    const year = date.getFullYear().toString();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

const ReportGraphBox = (props) =>{

    const translation = props.translation;
    const downloadTitle = props.downloadTitle;

    const graph = props.graph;
    const visibility = props.visibility;

    const graphRef = useRef(null);

    const captureChartAsImage = () => {
        console.log(graphRef.current)

        const chileTimezoneOffset = -3; // Chile is typically in UTC-3 time zone
        const currentDate = new Date();
        
        // Adjust the date and time to the Chile timezone
        currentDate.setUTCHours(currentDate.getUTCHours() + chileTimezoneOffset);
        
        // Get individual date and time components
        const day = currentDate.getUTCDate().toString().padStart(2, '0');
        const month = (currentDate.getUTCMonth() + 1).toString().padStart(2, '0');
        const year = currentDate.getUTCFullYear();
        const hours = currentDate.getUTCHours().toString().padStart(2, '0');
        const minutes = currentDate.getUTCMinutes().toString().padStart(2, '0');
        const seconds = currentDate.getUTCSeconds().toString().padStart(2, '0');
        
        // Create the formatted string
        const formattedTime = `${day}-${month}-${year}_${hours}-${minutes}-${seconds}`;

        if (graphRef.current) {
        html2canvas(graphRef.current).then((canvas) => {
            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF('landscape'); // Set landscape orientation
            const aspectRatio = canvas.width / canvas.height;
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = pdfWidth / aspectRatio;
            const x = 0;
            const y = (pdf.internal.pageSize.getHeight() - pdfHeight) / 2;
            pdf.addImage(imgData, 'PNG', x, y, pdfWidth, pdfHeight);
            pdf.save(downloadTitle+"_"+formattedTime+'_chart.pdf');
        });
        }
    };

    return <>
        {visibility && (
            <Grid item xs={12} md={6}>
                <Paper elevation={3} style={{ height: '100%' }}>
                    <Box p={3} display="flex" flexDirection="column" alignItems="center">
                        <div style={{ width: '150vh', height: 'auto' }} ref={graphRef}>
                            {graph}
                        </div>
                        <br />
                        <Tooltip title={translation("ReportGraphBox.downloadTooltip")}>
                            <IconButton color="primary" component="a" onClick={captureChartAsImage}>
                                <SaveAltIcon />
                                {translation("ReportGraphBox.download")}
                            </IconButton>
                        </Tooltip>
                    </Box>
                </Paper>
            </Grid>
        )}
    </>

}

export default ReportGraphBox;