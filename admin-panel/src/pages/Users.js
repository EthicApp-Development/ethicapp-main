import React from 'react';

//Components
import PageBase from '../components/PageBase';
import Container from '@mui/material/Container';
import HeaderNSubHeader from '../components/HeaderNSubHeader';

function Users(props) {
  const translation = props.translation;

  const pageTitle= translation("users.title");
  const pageSubTitle= translation("users.subTitle")

  return(
    <PageBase children={
      <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
        <HeaderNSubHeader title={pageTitle} subTitle={pageSubTitle}/>
      </Container>
    }/>
  );
}

export default Users;
