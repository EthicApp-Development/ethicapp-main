import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import AuthLayout from '../components/auth/AuthLayout';
import LoginForm from '../components/auth/LoginForm';
import CookieNoticeOverlay from '../components/common/CookieNoticeOverlay';
import useCookieNotice from '../hooks/useCookieNotice';

function LoginPage() {
  const { isOpen, isReady, acceptNotice } = useCookieNotice();   

  return (
    <>
        <AuthLayout
        title="Iniciar sesión"
        subtitle="Accede con tus credenciales"
        footer={
            <>
            <span>¿No tienes cuenta? </span>
            <Link to="/register">Crear cuenta</Link>
            </>
        }
        >
        <LoginForm />
        </AuthLayout>
        <CookieNoticeOverlay
            open={isOpen}
            onAccept={acceptNotice}
            privacyUrl="/privacy"
            termsUrl="/terms"
        />
    </>
  );
}

export default LoginPage;