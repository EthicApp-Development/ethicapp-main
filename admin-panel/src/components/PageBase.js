import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';

const PageBase = (props) =>{

    const children = props.children;

    return <Box
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
        {children}
    </Box>

}

export default PageBase;