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

const pageTitle= "Admin Home";
const pageSubTitle="From here you can update the data of the institution for which EthicApp operates, review reports, and manage users.."

function Home() {

  const gridData = [
    { icon: <SchoolIcon fontSize="large" />, text: 'Update institutional data', link:"/admin/institution", },
    { icon: <PeopleIcon fontSize="large" />, text: 'See Reports', link:"/admin/reports", },
    { icon: <BarChartIcon fontSize="large" />, text: 'Administer Users', link:"/admin/users", },
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
