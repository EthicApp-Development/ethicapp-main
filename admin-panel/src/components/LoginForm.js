import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Box from '@mui/material/Box';

const LoginForm = (props) =>{

    const handleSubmit = props.handleSubmit;
    const translation = props.translation;

    return <Box component="form" onSubmit={handleSubmit} noValidate sx={{ mt: 1 }}>
        <TextField
            margin="normal"
            required
            fullWidth
            id="email"
            label={translation("loginForm.email")}
            name="email"
            autoComplete="email"
            autoFocus
            />

        <TextField
            margin="normal"
            required
            fullWidth
            name="password"
            label={translation("loginForm.password")}
            type="password"
            id="password"
            autoComplete="current-password"
            />
        <Button
            type="submit"
            fullWidth
            variant="contained"
            sx={{ mt: 3, mb: 2 }}
            >
                {translation("loginForm.submit")}
        </Button>
    </Box>
}

export default LoginForm;