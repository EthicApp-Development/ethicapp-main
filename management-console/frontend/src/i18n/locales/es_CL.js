export default {
  app: {
    title: 'Consola de Gestión',
    subtitle: 'Operaciones de usuarios para entorno single-tenant'
  },
  nav: {
    users: 'Usuarios',
    institution: 'Institución',
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
        academic: 'Contacto académico'
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
