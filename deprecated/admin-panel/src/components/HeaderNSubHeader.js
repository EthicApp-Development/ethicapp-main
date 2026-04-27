import { Typography } from '@mui/material';

const HeaderNSubHeader = (props) =>{

    const title = props.title;
    const subTitle = props.subTitle;

    return <>
        <Typography variant="h4" gutterBottom>
            {title}
        </Typography>
        <Typography variant="h6" gutterBottom>
            {subTitle}
        </Typography>
    </> 
}

export default HeaderNSubHeader;