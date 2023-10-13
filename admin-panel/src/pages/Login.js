import React, { useEffect} from 'react';
import { useNavigate, Link } from 'react-router-dom';

//Components
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Container from '@mui/material/Container';
import LoginForm from '../components/LoginForm';
import Cookies from 'js-cookie';
import { useHistory } from 'react-router-dom';
import { Grid } from '@mui/material';
import { ApiLogin } from '../components/APICommunication';

//Icons
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';

function Login(props) {
  const translation = props.translation;
  const navigate = useNavigate();

  useEffect(() => {
    const sessionIdAux = Cookies.get('connect.sid');

    if (sessionIdAux) {
      navigate('/admin');
    }
  }, []);
 
  const handleSubmit = (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    let loginJson = {
      user: data.get('email'),
      pass: data.get('password'),
      source: "admin-panel"
    };

    ApiLogin(loginJson).then((response) => {
      if (response.data["sessionID"]=="ErrorCredential") {
        alert("Incorrect Credentials");
        return;
      }

      if (response.data["sessionID"]=="Unauthorized") {
        alert("User does not have access to Admin Panel");
        return;
      }

      Cookies.set('connect.sid', response.data["sessionID"], { expires: 1 });

      navigate('/admin');
    })
    .catch((error) => {
      console.error('Error fetching items:', error);
    });
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
