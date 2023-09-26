import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { Container, Paper, Typography } from '@mui/material';
import PageBase from '../components/PageBase';
import HeaderNSubHeader from '../components/HeaderNSubHeader';

function formatDate(dateStr) {
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  return new Date(dateStr).toLocaleDateString(undefined, options);
}

function Request(props) {
  const { id } = useParams();
  const pageTitle = 'Solicitud de Cuenta Profesor';

  const [requestData, setRequestData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios
      .get(`http://localhost:5050/teacher_account_requests/${id}`)
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

  return (
    <PageBase
      children={
        <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
          <HeaderNSubHeader title={pageTitle} />
          <br />

          {loading ? (
            <p>Cargando...</p>
          ) : (
            requestData ? (
              <Paper elevation={3} sx={{ padding: '16px' }}>
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                  Profesor
                </Typography>
                <Typography variant="body1">
                  Nombre: {requestData.name}
                </Typography>
                <Typography variant="body1">
                  Institución: {requestData.institution}
                </Typography>
                <Typography variant="body1">
                  Email: {requestData.mail}
                </Typography>
                <Typography variant="body1">
                  Rut: {requestData.rut}
                </Typography>
                <Typography variant="body1">
                  Género: {requestData.gender}
                </Typography>
                <Typography variant="body1">
                  Fecha: {formatDate(requestData.date)}
                </Typography>
              </Paper>
            ) : (
              <p>No se encontraron datos.</p>
            )
          )}
        </Container>
      }
    />
  );
}

export default Request;
