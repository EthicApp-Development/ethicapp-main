export default {
  app: {
    title: 'Consola de Gestión',
    subtitle: 'Operaciones de usuarios para entorno single-tenant'
  },
  nav: {
    aiServices: 'Servicios de IA',
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
  sensitiveAction: {
    defaultTitle: 'Confirma esta acción',
    loading: 'Revisando cómo confirmar...',
    passwordIntro: 'Para confirmar, ingresa tu contraseña de administrador y completa el reCAPTCHA.',
    passwordHelp: 'La contraseña de la cuenta de administrador con la que iniciaste sesión.',
    passkeyIntro: 'Para confirmar, usa tu passkey de administrador.',
    passkeyHelp: 'Al confirmar, el navegador te pedirá tu passkey.',
    passkeyUnsupported: 'Este administrador tiene passkeys, así que las acciones sensibles se confirman con una, pero este navegador no soporta passkeys. Usa un navegador que las soporte.',
    fields: {
      adminPassword: 'Contraseña de administrador'
    },
    actions: {
      cancel: 'Cancelar',
      close: 'Cerrar',
      confirm: 'Confirmar',
      confirmWithPasskey: 'Confirmar con passkey'
    },
    errors: {
      invalidPassword: 'La contraseña de administrador no es correcta. No se cambió nada.',
      invalidPasskey: 'No fue posible verificar la passkey. No se cambió nada.',
      invalidRecaptcha: 'La verificación reCAPTCHA falló. Complétala de nuevo. No se cambió nada.',
      passkeyRequired: 'Este administrador tiene passkeys, así que esta acción se confirma con una passkey. No se cambió nada.',
      passkeyFailed: 'La confirmación con passkey no terminó. No se cambió nada; puedes intentarlo de nuevo.'
    }
  },
  pages: {
    aiServices: {
      heading: 'Servicios de IA',
      description: 'Decide si esta instalación usa servicios de IA externos a través de AI Additions, y qué servicios están permitidos.',
      loading: 'Cargando servicios de IA...',
      loadError: 'No fue posible cargar la configuración de servicios de IA.',
      noConnection: {
        title: 'Esta instalación no usa IA externa',
        body: 'No hay una conexión con AI Additions configurada, así que EthicApp no envía nada a ningún servicio de IA. Ingresa una conexión más abajo para habilitar servicios de IA.'
      },
      connection: {
        heading: 'Conexión',
        description: 'Dónde EthicApp encuentra AI Additions. Las actividades en curso siguen esta conexión cuando cambia. Las credenciales de cliente de AI Additions siguen siendo secretos del despliegue de EthicApp.',
        lastUpdated: 'Guardada por última vez el {{date}} por {{author}}.',
        lastUpdatedNoAuthor: 'Guardada por última vez el {{date}}.',
        saveSuccess: 'Conexión guardada.',
        saveError: 'No fue posible guardar la conexión.',
        removeSuccess: 'Conexión eliminada. Esta instalación ya no usa IA externa.',
        removeError: 'No fue posible eliminar la conexión.',
        testError: 'No fue posible ejecutar la prueba de conexión.',
        fields: {
          baseUrl: 'URL de AI Additions',
          baseUrlHelp: 'Una URL http:// o https:// con un host (un nombre interno de Docker o un host externo) y una ruta opcional, por ejemplo https://ai.example.org/base. No se permiten usuario, contraseña, parámetros de consulta ni fragmento; se quita la barra final.',
          keycloakPublicUrl: 'URL pública de Keycloak (opcional)',
          keycloakPublicUrlHelp: 'Solo es necesaria cuando AI Additions publica Keycloak en otra URL. Sigue las mismas reglas que la URL de AI Additions. Por defecto es la URL de AI Additions seguida de /keycloak.'
        },
        errors: {
          INVALID_BASE_URL: 'Ingresa una URL http:// o https:// de AI Additions con un host y una ruta opcional, sin usuario, contraseña, parámetros de consulta ni fragmento.',
          INVALID_KEYCLOAK_PUBLIC_URL: 'Ingresa una URL http:// o https:// de Keycloak con un host y una ruta opcional, sin usuario, contraseña, parámetros de consulta ni fragmento, o déjala vacía.'
        },
        actions: {
          test: 'Probar conexión',
          save: 'Guardar conexión',
          remove: 'Eliminar conexión'
        },
        test: {
          token: 'Solicitud de token',
          issuer: {
            label: 'Emisor del token',
            invalidToken: 'El token no es un JWT con emisor (iss), así que no fue posible verificar su emisor.',
            mismatchExplanation: 'El emisor del token no coincide con el que EthicApp espera para estas URL. Con esta conexión, EthicApp rechazaría todas las llamadas de vuelta (callbacks) de AI Additions. El emisor esperado es la URL pública de Keycloak (o la URL de AI Additions seguida de /keycloak) más /realms/<realm>.',
            expected: 'Esperado',
            actual: 'En el token',
            suggestion: 'URL pública de Keycloak que coincide con el token:',
            realmMismatch: 'El realm del token no es el que usa EthicApp (AI_ADDITIONS_KEYCLOAK_REALM), así que ninguna URL pública de Keycloak lo resuelve; revisa el despliegue de EthicApp.'
          },
          catalog: 'Lectura del catálogo',
          success: 'La conexión funciona. AI Additions ofrece {{count}} servicios.',
          failure: 'La prueba de conexión falló. Las URL no se guardaron.',
          status: {
            ok: 'OK',
            failed: 'Falló',
            skipped: 'No se intentó'
          }
        },
        confirmSave: {
          title: '¿Guardar la conexión con AI Additions?',
          body: 'EthicApp se conectará a AI Additions en {{baseUrl}}.',
          details: 'Las actividades en curso pasan a usar la nueva conexión.'
        },
        remove: {
          title: '¿Eliminar la conexión con AI Additions?',
          body: 'Esto detiene de inmediato todas las llamadas a IA, incluso en las actividades que están en curso.',
          policyKept: 'Los servicios permitidos y su historial se conservan, y vuelven a aplicarse si más adelante se guarda una conexión.',
          confirm: 'Eliminar y detener toda la IA'
        }
      },
      services: {
        heading: 'Servicios permitidos',
        description: 'Los servicios que ofrece este despliegue de AI Additions. EthicApp solo puede usar los servicios permitidos.',
        launchNotice: 'Guardar crea una nueva versión de la política. Solo la usan las actividades lanzadas después; las actividades en curso mantienen la versión con la que se lanzaron.',
        noConnection: 'Configura una conexión para ver los servicios que ofrece AI Additions.',
        loading: 'Cargando el catálogo de AI Additions...',
        empty: 'Este despliegue de AI Additions no ofrece servicios.',
        retry: 'Reintentar',
        allowService: 'Permitir {{name}}',
        yes: 'Sí',
        no: 'No',
        available: 'Disponible',
        unavailable: 'No disponible',
        noAdapters: 'Ninguno',
        note: 'Nota (opcional)',
        notePlaceholder: '¿Por qué este cambio? Por ejemplo, el curso o estudio para el que es.',
        save: 'Guardar como nueva versión',
        saveSuccess: 'Versión {{version}} guardada.',
        saveError: 'No fue posible guardar la nueva versión.',
        staleIds: 'La versión actual permite servicios que AI Additions ya no ofrece ({{ids}}). Quedan fuera de la nueva versión.',
        disallowAll: 'No permitir ningún servicio',
        disallowAllHelp: 'No es posible leer el catálogo, así que ahora no se pueden permitir servicios. Igual puedes guardar una versión que no permita ninguno.',
        disallowAllNoConnectionHelp: 'No hay una conexión configurada, así que ahora no se pueden permitir servicios. La versión actual aún permite algunos; puedes guardar una versión que no permita ninguno.',
        confirmSave: {
          title: '¿Guardar una nueva versión de la política?',
          allowed: 'La nueva versión permite estos servicios: {{services}}.',
          none: 'La nueva versión no permite ningún servicio.',
          confirm: 'Guardar versión'
        },
        columns: {
          allowed: 'Permitido',
          service: 'Servicio',
          usesLlm: 'Usa un LLM',
          availability: 'Disponibilidad',
          adapters: 'Adaptadores de EthicApp que habilita'
        },
        errors: {
          unknownIds: 'AI Additions no ofrece estos servicios: {{ids}}.',
          catalogUnavailable: 'No fue posible leer el catálogo para verificar los servicios seleccionados.'
        }
      },
      history: {
        heading: 'Historial de versiones',
        description: 'Cada política guardada, de la más reciente a la más antigua. Las versiones nunca se editan. Las sesiones cuentan solo actividades lanzadas fijadas a cada versión.',
        empty: 'Aún no hay versiones.',
        current: 'Actual',
        systemAuthor: 'Sistema',
        noServices: 'Ningún servicio',
        columns: {
          version: 'Versión',
          date: 'Fecha',
          author: 'Autor',
          allowed: 'Servicios permitidos',
          note: 'Nota',
          sessions: 'Sesiones lanzadas'
        }
      },
      errors: {
        not_configured: 'No hay una conexión con AI Additions configurada.',
        credentials_missing: 'EthicApp no tiene credenciales de cliente de AI Additions, por lo que no se envió ninguna solicitud. Define AI_ADDITIONS_KEYCLOAK_CLIENT_ID y AI_ADDITIONS_KEYCLOAK_CLIENT_SECRET en la configuración de despliegue de EthicApp y vuelve a desplegarlo (ver "AI Services" en INSTALL.md).',
        unreachable: 'No fue posible contactar AI Additions.',
        unauthorized: 'AI Additions rechazó las credenciales de EthicApp.',
        invalid_response: 'AI Additions respondió de forma inesperada.',
        issuer_mismatch: 'El emisor del token no es el esperado.',
        ethicapp_error: 'EthicApp no pudo completar la solicitud. Verifica que el servicio EthicApp esté en ejecución y actualizado.',
        generic: 'La solicitud falló. Intenta de nuevo en unos segundos.'
      }
    },
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
        emailConfirmation: 'Confirmar email'
      },
      confirm: {
        save: {
          title: '¿Guardar los cambios de esta cuenta?',
          body: 'Se actualizará la cuenta de {{name}}.',
          confirm: 'Guardar cambios'
        },
        passwordReset: {
          title: '¿Enviar un correo de recuperación de contraseña?',
          body: 'Se enviará un correo de recuperación de contraseña a {{email}}.',
          confirm: 'Enviar correo'
        },
        impersonation: {
          title: '¿Ingresar como este profesor?',
          body: 'Usarás EthicApp como {{name}} hasta que vuelvas a la consola de gestión.',
          confirm: 'Ingresar como profesor'
        }
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
