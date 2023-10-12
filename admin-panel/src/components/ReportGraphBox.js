import React, { useRef } from 'react';
import { Paper, Grid, Box, IconButton, Tooltip } from '@mui/material';
import { SaveAlt as SaveAltIcon } from '@mui/icons-material';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

const ReportGraphBox = (props) =>{

    const translation = props.translation;

    const graph = props.graph;
    const visibility = props.visibility;

    const graphRef = useRef(null);

    const captureChartAsImage = () => {
        console.log(graphRef.current)
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
            pdf.save('chart.pdf');
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