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

function Login(props) {
  const translation = props.translation;
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
          {translation("login.login")}
        </Typography>

        <LoginForm handleSubmit={handleSubmit} translation={translation}/>

        <Grid container>
          <Grid item>
            <Link href="/" variant="body2">
              {translation("login.return")}
            </Link>
          </Grid>
        </Grid>

      </Box>
    </Container>
  );
}

export default Login;
