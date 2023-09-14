import React, { useState } from 'react';
import { Container, Tab, Tabs, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Button } from '@mui/material';
import PageBase from '../components/PageBase';
import HeaderNSubHeader from '../components/HeaderNSubHeader';

function Requests(props) {
  const translation = props.translation;

  const pageTitle = translation("requests.title");
  const pageSubTitle = translation("requests.subTitle");

  const [activeTab, setActiveTab] = useState(0);

  const handleTabChange = (event, newValue) => {
    setActiveTab(newValue);
  };

  const tabData = [
    { label: translation("requests.pending") },
    { label: translation("requests.approved")},
    { label: translation("requests.rejected")},
  ];

  const requestsData = [
    { id: 1, name: 'Luis Canales', email: 'email1@example.com', status: 'pending', date: '2021-10-10', institution: 'Institución 1' },
    { id: 2, name: 'Tomas Hernandez', email: 'email2@example.com', status: 'pending', date: '2021-10-09', institution: 'Institución 1' },
    { id: 3, name: 'Rosa Delgado', email: 'email3@example.com', status: 'pending', date: '2021-10-08', institution: 'Institución 1' },
    { id: 4, name: 'Raul Jimenez', email: 'email4@example.com', status: 'rejected', date: '2021-10-07', institution: 'Institución 1' },
    { id: 6, name: 'Sofia Lira', email: 'email6@example.com', status: 'approved', date: '2021-10-05', institution: 'Institución 1' },
    { id: 7, name: 'Manuel Ferrada', email: 'email7@example.com', status: 'approved', date: '2021-10-04', institution: 'Institución 1' },
  ];

  const filteredRequests = requestsData.filter((request) => {
    switch (activeTab) {
      case 0: // Pending
        return request.status === 'pending';
      case 1: // Approved
        return request.status === 'approved';
      case 2: // Rejected
        return request.status === 'rejected';
      default:
        return true;
    }
  });

  return (
    <PageBase
      children={
        <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
          <HeaderNSubHeader title={pageTitle} subTitle={pageSubTitle} />
          <br />

          <Tabs
            value={activeTab}
            onChange={handleTabChange}
            variant="fullWidth"
            indicatorColor="primary"
            textColor="primary"
          >
            {tabData.map((tab, index) => (
              <Tab key={index} label={tab.label} />
            ))}
          </Tabs>

          <TableContainer component={Paper} sx={{ mt: 2 }}>
            <Table>
              <TableBody>
                {filteredRequests.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell>
                      <b>{request.date} - {request.institution}</b>
                        <br></br>
                      {request.name}
                        <br></br>
                      {request.email}
                    </TableCell>
                    <TableCell>
                      {request.status === 'pending' && (
                        <Button variant="contained" color="primary">
                          {translation("requests.ignore")}
                        </Button>
                      )}
                    </TableCell>
                    <TableCell>
                    {request.status === 'pending' && (
                      <Button variant="contained" color="primary">
                        {translation("requests.see_request")}
                      </Button>
                    )}
                    {request.status === 'approved' && (
                      <Button variant="contained" color="primary">
                        {translation("requests.see_account")}
                      </Button>
                    )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Container>
      }
    />
  );
}

export default Requests;
