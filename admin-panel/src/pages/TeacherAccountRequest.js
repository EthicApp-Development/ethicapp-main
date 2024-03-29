import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { GetTeacherAccountRequest, UpdateTeacherAccountRequest } from '../components/APICommunication';
import { Container, Paper, Typography, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from '@mui/material';
import PageBase from '../components/PageBase';
import HeaderNSubHeader from '../components/HeaderNSubHeader';

function formatDate(dateStr) {
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  return new Date(dateStr).toLocaleDateString(undefined, options);
}

function TeacherAccountRequest(props) {
  const { id } = useParams();
  const translation = props.translation;

  const pageTitle = translation("teacherAccountRequest.title");

  const [requestData, setRequestData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    GetTeacherAccountRequest(id)
      .then((response) => {
        if (response.status === 200) {
          setRequestData(response.data);
        } else {
          console.error('Error al obtener datos:', response.status);
        }
        setLoading(false);
      })
      .catch((error) => {
        console.error('Error al obtener datos:', error);
        setLoading(false);
      });
  }, [id]);

  const handleAcceptRequest = () => {
    UpdateTeacherAccountRequest(id, { status: '1' })
      .then((response) => {
        if (response.status === 200) {
          window.location.href = '/admin/teacher_account_requests';
        } else {
          console.error('Error al aceptar la solicitud:', response.status);
        }
      })
      .catch((error) => {
        console.error('Error al aceptar la solicitud:', error);
      });
  };

  const [rejectReason, setRejectReason] = useState('');
  const [openModal, setOpenModal] = useState(false);

  const handleRejectRequest = () => {
    setOpenModal(true);
  };

  const handleModalClose = () => {
    setOpenModal(false);
  };

  const handleModalSubmit = () => {
    UpdateTeacherAccountRequest(id, { status: '2', reject_reason: rejectReason })
      .then((response) => {
        if (response.status === 200) {
          setOpenModal(false);
          window.location.href = '/admin/teacher_account_requests';
        } else {
          console.error('Error al rechazar la solicitud:', response.status);
        }
      })
      .catch((error) => {
        console.error('Error al rechazar la solicitud:', error);
      });
  };

  const handleIgnoreRequest = () => {
    UpdateTeacherAccountRequest(id, { status: '3' })
      .then((response) => {
        if (response.status === 200) {
          window.location.href = '/admin/teacher_account_requests';
        } else {
          console.error('Error al ignorar la solicitud:', response.status);
        }
      })
      .catch((error) => {
        console.error('Error al ignorar la solicitud:', error);
      });
  };

  return (
    <PageBase
      children={
        <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
          <HeaderNSubHeader title={pageTitle} />
          <br />

          {loading ? (
            <p>{translation("teacherAccountRequest.loading")}</p>
          ) : (
            requestData ? (
              <Paper elevation={3} sx={{ padding: '16px' }}>
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                  {translation("teacherAccountRequest.teacher")}
                </Typography>
                <Typography variant="body1">
                  {translation("teacherAccountRequest.name")}: {requestData.name}
                </Typography>
                <Typography variant="body1">
                  {translation("teacherAccountRequest.institution")}: {requestData.institution}
                </Typography>
                <Typography variant="body1">
                  {translation("teacherAccountRequest.email")}: {requestData.mail}
                </Typography>
                <Typography variant="body1">
                  {translation("teacherAccountRequest.rut")}: {requestData.rut}
                </Typography>
                <Typography variant="body1">
                  {translation("teacherAccountRequest.gender")}: {requestData.gender}
                </Typography>
                <Typography variant="body1">
                  {translation("teacherAccountRequest.date")}: {formatDate(requestData.date)}
                </Typography>

                <Button
                  variant="contained"
                  color="primary"
                  onClick={handleAcceptRequest}
                  sx={{ mt: 2 }}
                >
                  {translation("teacherAccountRequest.accept_request")}
                </Button>

                <Button
                  variant="contained"
                  color="primary"
                  onClick={handleRejectRequest}
                  sx={{ mt: 2, marginLeft: 2 }}
                >
                  {translation("teacherAccountRequest.reject_request")}
                </Button>

                <Button
                  variant="contained"
                  color="primary"
                  onClick={handleIgnoreRequest}
                  sx={{ mt: 2, marginLeft: 2 }}
                >
                  {translation("teacherAccountRequest.ignore_request")}
                </Button>


              </Paper>
            ) : (
              <p>{translation("teacherAccountRequest.no_data")}</p>
            )
          )}


          <Dialog open={openModal} onClose={handleModalClose}>
            <DialogTitle>{translation("teacherAccountRequest.reject_reason")}</DialogTitle>
            <DialogContent>
              <TextField
                fullWidth
                multiline
                rows={4}
                variant="outlined"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
            </DialogContent>
            <DialogActions>
              <Button onClick={handleModalClose} color="primary">
              {translation("teacherAccountRequest.cancel")}
              </Button>
              <Button onClick={handleModalSubmit} color="primary">
              {translation("teacherAccountRequest.send")}
              </Button>
            </DialogActions>
          </Dialog>

        </Container>
      }
    />
  );
}

export default TeacherAccountRequest;
