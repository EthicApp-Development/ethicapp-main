import React from 'react';
import { useNavigate, Link } from 'react-router-dom';

//Components
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Container from '@mui/material/Container';
import LoginForm from '../components/LoginForm';
import { Grid } from '@mui/material';

//Icons
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';

function Login() {
  const navigate = useNavigate();

  const handleSubmit = (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    console.log({
      email: data.get('email'),
      password: data.get('password'),
    });
    navigate('/admin');
  };


  return(
    <Container component="main" maxWidth="xs">
      <Box
        sx={{
          marginTop: 8,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Avatar sx={{ m: 1, bgcolor: 'secondary.main' }}>
          <LockOutlinedIcon />
        </Avatar>
        <Typography component="h1" variant="h5">
          Sign in
        </Typography>

        <LoginForm handleSubmit={handleSubmit}/>

        <Grid container>
          <Grid item>
            <Link href="/" variant="body2">
              Back To Ethicapp
            </Link>
          </Grid>
        </Grid>

      </Box>
    </Container>
  );
}

export default Login;
