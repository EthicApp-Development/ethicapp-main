import React from 'react';

//Components
import PageBase from '../components/PageBase';
import Container from '@mui/material/Container';
import HeaderNSubHeader from '../components/HeaderNSubHeader';

const pageTitle= "Users Page";
const pageSubTitle="Show all the user related actions"

function Users() {
  return(
    <PageBase children={
      <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
        <HeaderNSubHeader title={pageTitle} subTitle={pageSubTitle}/>
      </Container>
    }/>
  );
}

export default Users;
