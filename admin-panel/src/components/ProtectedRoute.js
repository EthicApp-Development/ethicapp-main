import React from 'react';
import { Navigate } from 'react-router-dom';
import Cookies from 'js-cookie';

const ProtectedRoute = ({ element }) => {
  // Check if the session ID cookie is set
  const sessionId = Cookies.get('connect.admin.sid');

  if (sessionId) {
    return element; // Render the element directly
  } else {
    // Redirect to the login page if the session ID is not set
    return <Navigate to="/admin/login" />;
  }
};

export default ProtectedRoute;