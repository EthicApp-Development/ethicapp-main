export default {
  app: {
    title: 'Management Console',
    subtitle: 'Single-tenant user operations'
  },
  nav: {
    aiServices: 'AI services',
    users: 'Users',
    institution: 'Institution',
    diagnostics: 'Diagnostics',
    profile: 'Profile',
    logout: 'Log out',
    collapseSidebar: 'Collapse navigation',
    expandSidebar: 'Expand navigation'
  },
  filters: {
    keywords: 'Search by first name, last name, email, or identifier',
    role: 'Filter by role',
    allRoles: 'All roles',
    search: 'Search'
  },
  roles: {
    P: 'Professor',
    A: 'Student',
    S: 'Administrator'
  },
  genders: {
    F: 'Female',
    M: 'Male',
    O: 'Other'
  },
  pages: {
    aiServices: {
      heading: 'AI services',
      description: 'Decide whether this installation uses external AI services through AI Additions, and which services are allowed.',
      loading: 'Loading AI services...',
      loadError: 'Unable to load the AI services configuration.',
      noConnection: {
        title: 'This installation uses no external AI',
        body: 'No AI Additions connection is configured, so EthicApp sends nothing to any AI service. Enter a connection below to enable AI services.'
      },
      connection: {
        heading: 'Connection',
        description: 'Where EthicApp reaches AI Additions. Running activities follow this connection when it changes. The AI Additions client credentials stay deployment secrets of EthicApp.',
        lastUpdated: 'Last saved {{date}} by {{author}}.',
        lastUpdatedNoAuthor: 'Last saved {{date}}.',
        saveSuccess: 'Connection saved.',
        saveError: 'Unable to save the connection.',
        removeSuccess: 'Connection removed. This installation no longer uses external AI.',
        removeError: 'Unable to remove the connection.',
        testError: 'Unable to run the connection test.',
        fields: {
          baseUrl: 'AI Additions URL',
          baseUrlHelp: 'An http:// or https:// URL with a host (a Docker-internal name or an external host) and an optional path, for example https://ai.example.org/base. User names, passwords, query strings and fragments are not allowed; a trailing slash is removed.',
          keycloakPublicUrl: 'Keycloak public URL (optional)',
          keycloakPublicUrlHelp: 'Only needed when AI Additions publishes Keycloak at another URL. Same rules as the AI Additions URL. Defaults to the AI Additions URL followed by /keycloak.'
        },
        errors: {
          INVALID_BASE_URL: 'Enter an http:// or https:// AI Additions URL with a host and an optional path, without user name, password, query string or fragment.',
          INVALID_KEYCLOAK_PUBLIC_URL: 'Enter an http:// or https:// Keycloak URL with a host and an optional path, without user name, password, query string or fragment, or leave it empty.'
        },
        actions: {
          test: 'Test connection',
          save: 'Save connection',
          remove: 'Remove connection'
        },
        test: {
          token: 'Token request',
          catalog: 'Catalog read',
          success: 'The connection works. AI Additions offers {{count}} services.',
          failure: 'The connection test failed. The URLs were not saved.',
          status: {
            ok: 'OK',
            failed: 'Failed',
            skipped: 'Not attempted'
          }
        },
        remove: {
          title: 'Remove the AI Additions connection?',
          body: 'This stops every AI call immediately, including in activities that are running now.',
          policyKept: 'The allowed services and their history are kept, and apply again if a connection is saved later.',
          cancel: 'Cancel',
          confirm: 'Remove and stop all AI'
        }
      },
      services: {
        heading: 'Allowed services',
        description: 'The services this AI Additions deployment offers. EthicApp can only use the allowed services.',
        launchNotice: 'Saving creates a new policy version. Only activities launched afterwards use it; running activities keep the version they were launched with.',
        noConnection: 'Configure a connection to see the services AI Additions offers.',
        loading: 'Loading the AI Additions catalog...',
        empty: 'This AI Additions deployment offers no services.',
        retry: 'Try again',
        allowService: 'Allow {{name}}',
        yes: 'Yes',
        no: 'No',
        available: 'Available',
        unavailable: 'Unavailable',
        noAdapters: 'None',
        note: 'Note (optional)',
        notePlaceholder: 'Why this change? For example, the course or study it is for.',
        save: 'Save as a new version',
        saveSuccess: 'Version {{version}} saved.',
        saveError: 'Unable to save the new version.',
        staleIds: 'The current version allows services that AI Additions no longer offers ({{ids}}). They are left out of the new version.',
        disallowAll: 'Allow no services',
        disallowAllHelp: 'The catalog cannot be read, so services cannot be allowed now. You can still save a version that allows no services.',
        disallowAllNoConnectionHelp: 'No connection is configured, so services cannot be allowed now. The current version still allows some; you can save a version that allows none.',
        columns: {
          allowed: 'Allowed',
          service: 'Service',
          usesLlm: 'Uses an LLM',
          availability: 'Availability',
          adapters: 'EthicApp adapters it enables'
        },
        errors: {
          unknownIds: 'AI Additions does not offer these services: {{ids}}.',
          catalogUnavailable: 'The catalog could not be read to check the selected services.'
        }
      },
      history: {
        heading: 'Version history',
        description: 'Every saved policy, newest first. Versions are never edited. Sessions count only launched activities pinned to each version.',
        empty: 'No versions yet.',
        current: 'Current',
        systemAuthor: 'System',
        noServices: 'No services',
        columns: {
          version: 'Version',
          date: 'Date',
          author: 'Author',
          allowed: 'Allowed services',
          note: 'Note',
          sessions: 'Launched sessions'
        }
      },
      errors: {
        not_configured: 'No AI Additions connection is configured.',
        unreachable: 'AI Additions could not be reached.',
        unauthorized: 'AI Additions rejected the EthicApp credentials.',
        invalid_response: 'AI Additions answered with an unexpected response.',
        ethicapp_error: 'EthicApp could not complete the request. Check that the EthicApp service is running and up to date.',
        generic: 'The request failed. Try again in a few seconds.'
      }
    },
    users: {
      heading: 'User management',
      description: 'This section will centralize user administration workflows.',
      columns: {
        firstname: 'First name',
        lastname: 'Last name',
        email: 'Email',
        role: 'Role',
        status: 'Status',
        actions: 'Actions'
      },
      status: {
        active: 'Active',
        inactive: 'Inactive',
        pending: 'Pending confirmation'
      },
      actions: {
        view: 'View details'
      },
      empty: 'No users found for the selected filters.',
      pagination: 'Page {{page}} of {{totalPages}} ({{total}} users)'
    },
    userShow: {
      heading: 'Account details',
      back: 'Back',
      roleHelp: 'Only student/professor role transitions are allowed.',
      adminPasswordHelp: 'You must confirm your administrator password to apply changes.',
      passkeyConfirmationHelp: 'Sensitive actions will ask for your administrator passkey instead of password and reCAPTCHA.',
      passkeyUnsupported: 'This administrator has passkeys configured, but this browser does not support passkey confirmation.',
      saveSuccess: 'User updated successfully.',
      saveError: 'Unable to update user.',
      passwordResetSuccess: 'Password recovery email was sent.',
      passwordResetError: 'Unable to trigger password recovery flow.',
      impersonationError: 'Unable to start professor impersonation.',
      fields: {
        firstname: 'First name',
        lastname: 'Last name',
        gender: 'Gender',
        role: 'Role',
        status: 'Account status',
        lastLogin: 'Last login',
        email: 'Email',
        emailConfirmation: 'Confirm email',
        adminPassword: 'Administrator password'
      },
      status: {
        active: 'Active account',
        inactive: 'Inactive account',
        emailConfirmed: 'Email confirmed',
        emailPending: 'Email confirmation pending',
        neverLoggedIn: 'Never'
      },
      actions: {
        save: 'Save changes',
        cancel: 'Cancel',
        triggerPasswordReset: 'Trigger password recovery',
        impersonateProfessor: 'Sign in as professor'
      }
    },
    profile: {
      heading: 'Administrator profile',
      loading: 'Loading profile...',
      loadError: 'Unable to load administrator profile.',
      passwordHeading: 'Change password',
      passwordDescription: 'Update your administrator password without using password recovery.',
      passwordChangeSuccess: 'Password updated successfully.',
      passwordChangeError: 'Unable to update password.',
      passkeys: {
        heading: 'Passkeys',
        description: 'Register a passkey for stronger administrator authentication.',
        empty: 'No passkeys have been registered for this administrator yet.',
        unsupported: 'This browser does not support passkeys.',
        defaultName: 'Unnamed passkey',
        neverUsed: 'Never',
        createdAt: 'Created: {{date}}',
        lastUsedAt: 'Last used: {{date}}',
        registerSuccess: 'Passkey registered successfully.',
        registerError: 'Unable to register passkey.',
        deleteSuccess: 'Passkey removed successfully.',
        deleteError: 'Unable to remove passkey.',
        fields: {
          name: 'Passkey name',
          namePlaceholder: 'MacBook Touch ID, YubiKey, phone...',
          deletePassword: 'Current password to remove passkeys'
        },
        actions: {
          add: 'Add passkey',
          remove: 'Remove'
        }
      },
      fields: {
        name: 'Name',
        email: 'Email',
        role: 'Role',
        currentPassword: 'Current password',
        newPassword: 'New password',
        passwordConfirmation: 'Confirm new password'
      },
      passwordRules: {
        helpText: 'Minimum 10 characters and at least 2 symbols.',
        minLength: 'At least 10 characters',
        twoSymbols: 'At least 2 symbols'
      },
      errors: {
        required: 'Complete all password fields.',
        weakPassword: 'The new password must have at least 10 characters and 2 symbols.',
        passwordMismatch: 'New password and confirmation do not match.'
      },
      actions: {
        changePassword: 'Change password'
      }
    },
    diagnostics: {
      heading: 'Health diagnostics',
      description: 'Check whether this deployment can resolve and reach the external services it depends on.',
      vantagePoint: 'Results show the network as seen from the management-console container. Services in the same docker compose project share its DNS configuration, so they usually see the same results; a service with its own DNS or network settings may differ.',
      noTargets: 'No diagnostics targets are configured. Set {{variable}} on the management-console service to list the hosts to check.',
      requestError: 'The check could not be run. Try again in a few seconds.',
      running: 'Running check...',
      lastRun: 'Last run: {{time}}',
      actions: {
        run: 'Run checks'
      },
      status: {
        ok: 'OK',
        failed: 'Failed',
        skipped: 'Skipped'
      },
      columns: {
        target: 'Target'
      },
      dns: {
        heading: 'DNS resolution',
        description: 'Resolves each target through the operating system resolver used by the applications and by querying the DNS servers directly.',
        containerResolvers: 'Container resolvers',
        upstreamResolvers: 'Upstream resolvers (Docker)',
        upstreamUnknown: 'Not reported by Docker',
        columns: {
          lookup: 'System resolver',
          resolve: 'DNS servers'
        }
      },
      connectivity: {
        heading: 'Outbound connectivity',
        description: 'Opens a connection to each target and reports the first stage that fails: DNS, TCP or TLS.',
        deadlineExceeded: 'The check reached its time limit before every target finished.',
        failedAt: 'Failed at {{stage}}',
        notRun: 'Not run',
        certificate: 'Issued by {{issuer}}, valid until {{validTo}}',
        columns: {
          result: 'Result'
        },
        stages: {
          dns: 'DNS',
          tcp: 'TCP',
          tls: 'TLS'
        }
      },
      errorHints: {
        ENOTFOUND: 'The name does not exist or the resolver could not find it.',
        ETIMEOUT: 'No answer within the time limit.',
        ESERVFAIL: 'The DNS server failed to answer the query.',
        ECONNREFUSED: 'The host is reachable but nothing accepts connections on this port.',
        ENETUNREACH: 'There is no network route to this address.',
        EHOSTUNREACH: 'The host cannot be reached.',
        ENODATA: 'The name exists but has no addresses.',
        EDEADLINE: 'The overall time limit for the check was reached.',
        CERT_HAS_EXPIRED: 'The server certificate has expired.',
        ERR_TLS_CERT_ALTNAME_INVALID: 'The server certificate does not match this host name.',
        DEPTH_ZERO_SELF_SIGNED_CERT: 'The server uses a self-signed certificate.',
        SELF_SIGNED_CERT_IN_CHAIN: 'The certificate chain includes an untrusted self-signed certificate, which may indicate a TLS-intercepting proxy.',
        UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'The server certificate could not be verified against a trusted authority.'
      }
    },
    institution: {
      heading: 'Institution',
      description: 'Configure the institutional identity and support contacts for this EthicApp installation.',
      loading: 'Loading institution...',
      loadError: 'Unable to load institution settings.',
      saveSuccess: 'Institution settings updated successfully.',
      saveError: 'Unable to update institution settings.',
      logoHelp: 'PNG or JPG, maximum 1 MB.',
      fields: {
        name: 'Institution name',
        logo: 'Institution logo',
        firstname: 'First name',
        lastname: 'Last name',
        email: 'Email',
        phoneCountryCode: 'Country code',
        phoneNumber: 'Phone number'
      },
      contacts: {
        technical: 'Technical contact',
        academic: 'Academic contact',
        data_privacy: 'Data privacy contact'
      },
      errors: {
        nameRequired: 'Institution name is required.',
        invalidLogoType: 'The logo must be a PNG or JPG image.',
        invalidLogoData: 'The logo file could not be processed.',
        logoTooLarge: 'The logo exceeds the 1 MB limit.'
      },
      actions: {
        save: 'Save institution',
        removeLogo: 'Remove logo'
      }
    }
  }
};
