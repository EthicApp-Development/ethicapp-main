export default {
  app: {
    title: 'Consola de Gestión',
    subtitle: 'Operaciones de usuarios para entorno single-tenant'
  },
  nav: {
    users: 'Usuarios',
    institution: 'Institución',
    diagnostics: 'Diagnóstico',
    profile: 'Perfil',
    logout: 'Cerrar sesión',
    collapseSidebar: 'Colapsar navegación',
    expandSidebar: 'Expandir navegación'
  },
  filters: {
    keywords: 'Buscar por nombre, apellido, email o identificador',
    role: 'Filtrar por rol',
    allRoles: 'Todos los roles',
    search: 'Buscar'
  },
  roles: {
    P: 'Profesor',
    A: 'Estudiante',
    S: 'Administrador'
  },
  genders: {
    F: 'Femenino',
    M: 'Masculino',
    O: 'Otro'
  },
  pages: {
    users: {
      heading: 'Gestión de usuarios',
      description: 'Esta sección centralizará los flujos de administración de usuarios.',
      columns: {
        firstname: 'Nombre',
        lastname: 'Apellido',
        email: 'Email',
        role: 'Rol',
        status: 'Estado',
        actions: 'Acciones'
      },
      status: {
        active: 'Activa',
        inactive: 'Inactiva',
        pending: 'Pendiente de confirmación'
      },
      actions: {
        view: 'Ver detalle'
      },
      empty: 'No se encontraron usuarios para los filtros aplicados.',
      pagination: 'Página {{page}} de {{totalPages}} ({{total}} usuarios)'
    },
    userShow: {
      heading: 'Detalle de cuenta',
      back: 'Volver',
      roleHelp: 'Solo se permite cambiar entre estudiante y profesor.',
      adminPasswordHelp: 'Debes confirmar tu contraseña de administrador para aplicar cambios.',
      passkeyConfirmationHelp: 'Las acciones sensibles pedirán tu passkey de administrador en vez de contraseña y reCAPTCHA.',
      passkeyUnsupported: 'Este administrador tiene passkeys configuradas, pero este navegador no soporta confirmación con passkey.',
      saveSuccess: 'Usuario actualizado correctamente.',
      saveError: 'No fue posible actualizar el usuario.',
      passwordResetSuccess: 'Se envió el correo de recuperación de contraseña.',
      passwordResetError: 'No fue posible gatillar la recuperación de contraseña.',
      impersonationError: 'No fue posible iniciar impersonación del profesor.',
      fields: {
        firstname: 'Nombre',
        lastname: 'Apellido',
        gender: 'Género',
        role: 'Rol',
        status: 'Estado de cuenta',
        lastLogin: 'Último login',
        email: 'Email',
        emailConfirmation: 'Confirmar email',
        adminPassword: 'Contraseña de administrador'
      },
      status: {
        active: 'Cuenta activa',
        inactive: 'Cuenta inactiva',
        emailConfirmed: 'Correo confirmado',
        emailPending: 'Confirmación de correo pendiente',
        neverLoggedIn: 'Nunca'
      },
      actions: {
        save: 'Guardar cambios',
        cancel: 'Cancelar',
        triggerPasswordReset: 'Gatillar recuperación de contraseña',
        impersonateProfessor: 'Ingresar como profesor'
      }
    },
    profile: {
      heading: 'Perfil de administrador',
      loading: 'Cargando perfil...',
      loadError: 'No fue posible cargar el perfil de administrador.',
      passwordHeading: 'Cambiar contraseña',
      passwordDescription: 'Actualiza tu contraseña de administrador sin usar recuperación de contraseña.',
      passwordChangeSuccess: 'Contraseña actualizada correctamente.',
      passwordChangeError: 'No fue posible actualizar la contraseña.',
      passkeys: {
        heading: 'Passkeys',
        description: 'Registra una passkey para fortalecer la autenticación de administrador.',
        empty: 'Este administrador aún no tiene passkeys registradas.',
        unsupported: 'Este navegador no soporta passkeys.',
        defaultName: 'Passkey sin nombre',
        neverUsed: 'Nunca',
        createdAt: 'Creada: {{date}}',
        lastUsedAt: 'Último uso: {{date}}',
        registerSuccess: 'Passkey registrada correctamente.',
        registerError: 'No fue posible registrar la passkey.',
        deleteSuccess: 'Passkey eliminada correctamente.',
        deleteError: 'No fue posible eliminar la passkey.',
        fields: {
          name: 'Nombre de la passkey',
          namePlaceholder: 'Touch ID del MacBook, YubiKey, teléfono...',
          deletePassword: 'Contraseña actual para eliminar passkeys'
        },
        actions: {
          add: 'Agregar passkey',
          remove: 'Eliminar'
        }
      },
      fields: {
        name: 'Nombre',
        email: 'Email',
        role: 'Rol',
        currentPassword: 'Contraseña actual',
        newPassword: 'Nueva contraseña',
        passwordConfirmation: 'Confirmar nueva contraseña'
      },
      passwordRules: {
        helpText: 'Mínimo 10 caracteres y al menos 2 símbolos.',
        minLength: 'Al menos 10 caracteres',
        twoSymbols: 'Al menos 2 símbolos'
      },
      errors: {
        required: 'Completa todos los campos de contraseña.',
        weakPassword: 'La nueva contraseña debe tener al menos 10 caracteres y 2 símbolos.',
        passwordMismatch: 'La nueva contraseña y su confirmación no coinciden.'
      },
      actions: {
        changePassword: 'Cambiar contraseña'
      }
    },
    diagnostics: {
      heading: 'Diagnóstico de salud',
      description: 'Verifica si este despliegue puede resolver y alcanzar los servicios externos de los que depende.',
      vantagePoint: 'Los resultados muestran la red vista desde el contenedor de management-console. Los servicios del mismo proyecto de docker compose comparten su configuración DNS, por lo que normalmente ven lo mismo; un servicio con DNS o red propios puede diferir.',
      noTargets: 'No hay destinos de diagnóstico configurados. Define {{variable}} en el servicio management-console con los hosts a revisar.',
      requestError: 'No fue posible ejecutar la revisión. Intenta de nuevo en unos segundos.',
      running: 'Ejecutando revisión...',
      lastRun: 'Última ejecución: {{time}}',
      actions: {
        run: 'Ejecutar revisiones'
      },
      status: {
        ok: 'OK',
        failed: 'Falló',
        skipped: 'Omitido'
      },
      columns: {
        target: 'Destino'
      },
      dns: {
        heading: 'Resolución DNS',
        description: 'Resuelve cada destino con el resolver del sistema operativo que usan las aplicaciones y consultando directamente a los servidores DNS.',
        containerResolvers: 'Resolvers del contenedor',
        upstreamResolvers: 'Resolvers de origen (Docker)',
        upstreamUnknown: 'Docker no los informa',
        columns: {
          lookup: 'Resolver del sistema',
          resolve: 'Servidores DNS'
        }
      },
      connectivity: {
        heading: 'Conectividad saliente',
        description: 'Abre una conexión a cada destino e informa la primera etapa que falla: DNS, TCP o TLS.',
        deadlineExceeded: 'La revisión alcanzó su tiempo límite antes de terminar con todos los destinos.',
        failedAt: 'Falló en {{stage}}',
        notRun: 'No ejecutada',
        certificate: 'Emitido por {{issuer}}, válido hasta {{validTo}}',
        columns: {
          result: 'Resultado'
        },
        stages: {
          dns: 'DNS',
          tcp: 'TCP',
          tls: 'TLS'
        }
      },
      errorHints: {
        ENOTFOUND: 'El nombre no existe o el resolver no lo encontró.',
        ETIMEOUT: 'No hubo respuesta dentro del tiempo límite.',
        ESERVFAIL: 'El servidor DNS no pudo responder la consulta.',
        ECONNREFUSED: 'El host responde, pero nada acepta conexiones en este puerto.',
        ENETUNREACH: 'No hay ruta de red hacia esta dirección.',
        EHOSTUNREACH: 'No es posible alcanzar el host.',
        ENODATA: 'El nombre existe, pero no tiene direcciones.',
        EDEADLINE: 'Se alcanzó el tiempo límite total de la revisión.',
        CERT_HAS_EXPIRED: 'El certificado del servidor expiró.',
        ERR_TLS_CERT_ALTNAME_INVALID: 'El certificado del servidor no corresponde a este nombre de host.',
        DEPTH_ZERO_SELF_SIGNED_CERT: 'El servidor usa un certificado autofirmado.',
        SELF_SIGNED_CERT_IN_CHAIN: 'La cadena de certificados incluye un certificado autofirmado no confiable, lo que puede indicar un proxy que intercepta TLS.',
        UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'No fue posible verificar el certificado del servidor con una autoridad de confianza.'
      }
    },
    institution: {
      heading: 'Institución',
      description: 'Configura la identidad institucional y los contactos de soporte para esta instalación de EthicApp.',
      loading: 'Cargando institución...',
      loadError: 'No fue posible cargar la configuración institucional.',
      saveSuccess: 'Configuración institucional actualizada correctamente.',
      saveError: 'No fue posible actualizar la configuración institucional.',
      logoHelp: 'PNG o JPG, máximo 1 MB.',
      fields: {
        name: 'Nombre de la institución',
        logo: 'Logo institucional',
        firstname: 'Nombre',
        lastname: 'Apellido',
        email: 'Email',
        phoneCountryCode: 'Código de país',
        phoneNumber: 'Teléfono'
      },
      contacts: {
        technical: 'Contacto técnico',
        academic: 'Contacto académico',
        data_privacy: 'Contacto de protección de datos'
      },
      errors: {
        nameRequired: 'El nombre de la institución es obligatorio.',
        invalidLogoType: 'El logo debe ser una imagen PNG o JPG.',
        invalidLogoData: 'No fue posible procesar el archivo del logo.',
        logoTooLarge: 'El logo supera el límite de 1 MB.'
      },
      actions: {
        save: 'Guardar institución',
        removeLogo: 'Quitar logo'
      }
    }
  }
};
