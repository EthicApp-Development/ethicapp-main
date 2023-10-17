import React, { useState, useEffect } from 'react';
import { GetTeacherAccountRequests } from '../components/APICommunication';
import { Container, Tab, Tabs, Table, TableBody, TableCell, TableContainer, TableRow, Paper, Button } from '@mui/material';
import PageBase from '../components/PageBase';
import HeaderNSubHeader from '../components/HeaderNSubHeader';
import {Link} from "react-router-dom"

function TeacherAccountRequests(props) {
  const translation = props.translation;

  const pageTitle = translation("teacherAccountRequests.title");
  const pageSubTitle = translation("teacherAccountRequests.subTitle");

  const [activeTab, setActiveTab] = useState(0);

  const handleTabChange = (event, newValue) => {
    setActiveTab(newValue);
  };

  const tabData = [
    { label: translation("teacherAccountRequests.pending") },
    { label: translation("teacherAccountRequests.approved")},
    { label: translation("teacherAccountRequests.rejected")},
  ];

  const [requestsData, setRequestsData] = useState([]);

  useEffect(() => {
    GetTeacherAccountRequests()
      .then((response) => {
        if (response.status === 200) {
          if (Array.isArray(response.data)) {
            setRequestsData(response.data);
          }
          else {
            console.error('Error al obtener datos (no son una lista):', response.status);
          }
        } else {
          console.error('Error al obtener datos:', response.status);
        }
      })
      .catch((error) => {
        console.error('Error al obtener datos:', error);
      });
  }, []);

  const filteredRequests = requestsData.filter((request) => {
    switch (activeTab) {
      case 0: // Pending
        return request.status === "0";
      case 1: // Approved
        return request.status === "1";
      case 2: // Rejected
        return request.status === "2";
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
                    {activeTab === 0 && (
                      <>
                        <TableCell>
                          <Button variant="contained" color="primary">
                            {translation("teacherAccountRequests.ignore")}
                          </Button>
                        </TableCell>
                        <TableCell>
                        <Link to={`/admin/teacher_account_request/${request.id}`} style={{ textDecoration: 'none' }}>
                          <Button variant="contained" color="primary">
                            {translation("teacherAccountRequests.see_request")}
                          </Button>
                        </Link>
                        </TableCell>
                      </>
                    )}
                    {activeTab === 1 && (
                      <>
                        <TableCell>
                          <Button variant="contained" color="primary">
                            {translation("teacherAccountRequests.see_account")}
                          </Button>
                        </TableCell>
                      </>
                    )}
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

export default TeacherAccountRequests;
