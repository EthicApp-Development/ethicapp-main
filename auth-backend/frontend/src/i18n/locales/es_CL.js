const esCL = {
  passwordField: {
    defaultLabel: 'Contraseña',
    visibility: {
      show: 'Ver',
      hide: 'Ocultar'
    }
  },
  login: {
    title: 'Iniciar sesión',
    subtitle: 'Accede con tus credenciales',
    noAccount: '¿No tienes cuenta?',
    createAccount: 'Crear cuenta',
    usernameLabel: 'Usuario',
    passwordLabel: 'Contraseña',
    forgotPassword: '¿Has olvidado tu contraseña?',
    submit: 'Entrar',
    submitting: 'Accediendo...',
    continuePolicyPrefix: 'Al continuar, aceptas nuestra',
    privacyPolicy: 'Política de Privacidad',
    termsOfUse: 'Términos de Uso',
    continuePolicyConnector: 'y',
    continuePolicySuffix: '.',
    errors: {
      usernameRequired: 'El usuario es obligatorio.',
      passwordRequired: 'La contraseña es obligatoria.',
      genericLoginError: 'No se ha podido iniciar sesión. Verifica tus credenciales.'
    }
  },
  register: {
    pageTitle: 'Crear cuenta',
    pageSubtitle: 'Completa tus datos para registrarte',
    fields: {
      firstname: 'Nombre',
      lastname: 'Apellido',
      dni: 'DNI / RUT',
      email: 'Correo electrónico',
      gender: 'Género',
      password: 'Contraseña',
      passwordConfirmation: 'Confirmar contraseña'
    },
    placeholders: {
      dni: 'Sin puntos, con guión',
      gender: 'Selecciona una opción'
    },
    genderOptions: {
      female: 'Femenino',
      male: 'Masculino',
      other: 'Otro'
    },
    passwordRules: {
      helpText: 'Mínimo 10 caracteres y al menos 2 símbolos.',
      minLength: 'Mínimo 10 caracteres',
      twoSymbols: 'Al menos 2 símbolos'
    },
    submit: 'Crear cuenta',
    submitting: 'Registrando...',
    privacyAcceptancePrefix: 'He leído y acepto la',
    privacyPolicy: 'Política de Privacidad',
    privacyAcceptanceSuffix: '.',
    privacyNoticePartOne: 'Tus datos se utilizarán para gestionar tu cuenta y el uso de la plataforma.',
    privacyNoticePartTwo:
      'El uso de datos con fines de investigación se realizará únicamente con tu consentimiento explícito en el contexto de estudios específicos.',
    privacyNoticePartThreePrefix: 'Consulta más información en nuestra',
    privacyNoticePartThreeSuffix: '.',
    alreadyHaveAccount: '¿Ya tienes cuenta?',
    signInLink: 'Iniciar sesión',
    successMessage: 'Cuenta creada correctamente. Ya puedes iniciar sesión.',
    recoverPasswordLink: 'Recuperar contraseña',
    errors: {
      firstnameRequired: 'El nombre es obligatorio.',
      lastnameRequired: 'El apellido es obligatorio.',
      dniRequired: 'El identificador es obligatorio.',
      emailRequired: 'El correo electrónico es obligatorio.',
      emailInvalid: 'Introduce un correo electrónico válido.',
      genderRequired: 'Debes seleccionar una opción.',
      passwordRequired: 'La contraseña es obligatoria.',
      passwordInvalid: 'La contraseña debe tener al menos 10 caracteres y 2 símbolos.',
      passwordConfirmationRequired: 'Debes confirmar la contraseña.',
      passwordMismatch: 'Las contraseñas no coinciden.',
      privacyAcceptanceRequired: 'Debes aceptar la Política de Privacidad para crear una cuenta.',
      recaptchaRequired: 'Debes completar el reCAPTCHA.',
      emailAlreadyRegistered: 'Ya existe una cuenta con ese correo electrónico.',
      genericRegisterError: 'No se ha podido completar el registro. Inténtalo de nuevo.'
    }
  },
  forgotPassword: {
    pageTitle: 'Recuperar contraseña',
    pageSubtitle: 'Te ayudaremos a restablecer el acceso a tu cuenta',
    emailLabel: 'Correo electrónico',
    instructions:
      'Introduce el correo asociado a tu cuenta y te enviaremos un enlace para restablecer tu contraseña.',
    submit: 'Enviar instrucciones',
    submitting: 'Enviando...',
    backToLogin: 'Volver a iniciar sesión',
    successMessage:
      'Si existe una cuenta asociada a ese correo, recibirás instrucciones para restablecer la contraseña.',
    errors: {
      emailRequired: 'El correo electrónico es obligatorio.',
      emailInvalid: 'Introduce un correo electrónico válido.',
      recaptchaRequired: 'Debes completar el reCAPTCHA.',
      genericForgotError: 'No se ha podido procesar la solicitud. Inténtalo de nuevo.'
    }
  },
  resetPassword: {
    pageTitle: 'Nueva contraseña',
    pageSubtitle: 'Introduce tu nueva contraseña para recuperar el acceso',
    passwordLabel: 'Nueva contraseña',
    passwordConfirmationLabel: 'Confirmar nueva contraseña',
    submit: 'Actualizar contraseña',
    submitting: 'Actualizando...',
    backToLogin: 'Volver a iniciar sesión',
    successMessage: 'La contraseña se ha actualizado correctamente. Serás redirigido para iniciar sesión.',
    passwordRules: {
      helpText: 'Mínimo 10 caracteres y al menos 2 símbolos.',
      minLength: 'Mínimo 10 caracteres',
      twoSymbols: 'Al menos 2 símbolos'
    },
    errors: {
      invalidToken: 'El enlace de recuperación no es válido.',
      passwordRequired: 'La nueva contraseña es obligatoria.',
      passwordInvalid: 'La contraseña debe tener al menos 10 caracteres y 2 símbolos.',
      passwordConfirmationRequired: 'Debes confirmar la contraseña.',
      passwordMismatch: 'Las contraseñas no coinciden.',
      genericResetError: 'No se ha podido restablecer la contraseña. Solicita un nuevo enlace.'
    }
  },
  notFound: {
    code: '404',
    title: 'Página no encontrada',
    message: 'La página solicitada no existe o fue movida.',
    backToLogin: 'Volver a iniciar sesión'
  },
  legal: {
    back: 'Volver',
    privacy: {
      title: 'Política de Privacidad',
      updatedAt: 'Última actualización: 15 de abril de 2026'
    },
    terms: {
      title: 'Términos de Uso',
      updatedAt: 'Última actualización: 16 de abril de 2026'
    }
  },
  cookieNotice: {
    title: 'Información sobre cookies y sesión',
    closeLabel: 'Cerrar aviso',
    acceptLabel: 'Entendido',
    linksPrefix: 'Puedes consultar',
    privacyPolicy: 'la política de privacidad',
    linksConnector: 'y',
    termsOfService: 'los términos del servicio'
  }
};

export default esCL;
