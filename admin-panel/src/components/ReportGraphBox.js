import { Paper, Grid, Box, IconButton, Tooltip } from '@mui/material';
import { SaveAlt as SaveAltIcon } from '@mui/icons-material';

const ReportGraphBox = (props) =>{

    const translation = props.translation;

    const graph = props.graph;
    const visibility = props.visibility;

    return<>         
        {visibility && (
            <Grid item xs={12} md={6}>
                <Paper elevation={3} style={{ height: '100%' }}>
                    <Box p={3}>
                        <Tooltip title={translation("ReportGraphBox.downloadTooltip")}>
                            <IconButton color="primary" component="a">
                                <SaveAltIcon />
                                {translation("ReportGraphBox.download")}
                            </IconButton>
                        </Tooltip>
                        <div style={{ width: 'auto', height: 'auto', alignContent: 'center'}}>
                            {graph}
                        </div>
                    </Box>
                </Paper>
            </Grid>
        )}
    </>

}

export default ReportGraphBox;