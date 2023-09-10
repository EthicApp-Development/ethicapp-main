import React from 'react';
import { Link } from 'react-router-dom';

function Login() {
  return(
    <>
      <h2>Login View</h2>
      <h2>Show login credentials here</h2>
      <Link to="/admin">Fake Login</Link>
    </>
  );
}

export default Login;
