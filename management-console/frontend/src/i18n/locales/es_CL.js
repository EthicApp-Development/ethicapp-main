export default {
  app: {
    title: 'Consola de Gestión',
    subtitle: 'Operaciones de usuarios para entorno single-tenant'
  },
  nav: {
    users: 'Usuarios',
    logout: 'Cerrar sesión'
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
        actions: 'Acciones'
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
        email: 'Email',
        emailConfirmation: 'Confirmar email',
        adminPassword: 'Contraseña de administrador'
      },
      actions: {
        save: 'Guardar cambios',
        cancel: 'Cancelar',
        triggerPasswordReset: 'Gatillar recuperación de contraseña',
        impersonateProfessor: 'Ingresar como profesor'
      }
    }
  }
};
