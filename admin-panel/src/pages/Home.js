import React from 'react';

//Components
import PageBase from '../components/PageBase';
import BoxGrid from '../components/BoxGrid';
import HeaderNSubHeader from '../components/HeaderNSubHeader';
import { Container } from '@mui/material';

//Icons
import SchoolIcon from '@mui/icons-material/School';
import PeopleIcon from '@mui/icons-material/People';
import BarChartIcon from '@mui/icons-material/BarChart';

function Home(props) {

  const translation = props.translation;

  const pageTitle= translation("home.title");
  const pageSubTitle= translation("home.subTitle")

  const gridData = [
    { icon: <SchoolIcon fontSize="large" />, text: translation("home.institutionBox"), link:"/admin/institution", },
    { icon: <PeopleIcon fontSize="large" />, text: translation("home.usersBox"), link:"/admin/users", },
    { icon: <BarChartIcon fontSize="large" />, text: translation("home.chartBox"), link:"/admin/reports", },
    // Add more data as needed
  ];

  return(
    <PageBase children={
      <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
        <HeaderNSubHeader title={pageTitle} subTitle={pageSubTitle}/>
        <br/>
        <BoxGrid gridData={gridData} />
      </Container>
    }/>
  );
}

export default Home;
