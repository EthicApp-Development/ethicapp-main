import { Grid, Typography, styled, Box } from '@mui/material';
import { Link } from 'react-router-dom';

// Override link styles
const StyledLink = styled(Link)`
  text-decoration: none;
  color: inherit; /* Inherit text color from parent */
`;

const BoxGrid = (props) =>{

    const gridData = props.gridData;
    const handleMouseOver = props.handleMouseOver;

    return <Grid container spacing={2}>
    {gridData.map((item, index) => (
      <Grid item xs={12} sm={6} md={4} lg={3} key={index}>
        <StyledLink to={`${item.link}`} style={{ textDecoration: 'none' }}>
          <Box display="flex" alignItems="center" border="1px solid black" padding={2} 
            onMouseEnter={handleMouseOver ? () => handleMouseOver(item.reportType) : null}>
              
            <Box marginRight={2}>{item.icon}</Box>
            <Typography variant="body1">{item.text}</Typography>
          </Box>
        </StyledLink>
      </Grid>
    ))}
  </Grid>

}

export default BoxGrid;