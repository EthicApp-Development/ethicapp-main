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
    status: 'Filter by status',
    allStatuses: 'All statuses',
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
  sensitiveAction: {
    defaultTitle: 'Confirm this action',
    loading: 'Checking how to confirm...',
    passwordIntro: 'To confirm, enter your administrator password and complete the reCAPTCHA.',
    passwordHelp: 'The password of the administrator account you are signed in with.',
    passkeyIntro: 'To confirm, use your administrator passkey.',
    passkeyHelp: 'Your browser will ask for your passkey when you confirm.',
    passkeyUnsupported: 'This administrator has passkeys, so sensitive actions must be confirmed with one, but this browser does not support passkeys. Use a browser that does.',
    fields: {
      adminPassword: 'Administrator password'
    },
    actions: {
      cancel: 'Cancel',
      close: 'Close',
      confirm: 'Confirm',
      confirmWithPasskey: 'Confirm with passkey'
    },
    errors: {
      invalidPassword: 'The administrator password is not correct. Nothing was changed.',
      invalidPasskey: 'The passkey could not be verified. Nothing was changed.',
      invalidRecaptcha: 'The reCAPTCHA check failed. Complete it again. Nothing was changed.',
      passkeyRequired: 'This administrator has passkeys, so this action must be confirmed with a passkey. Nothing was changed.',
      passkeyFailed: 'The passkey confirmation did not complete. Nothing was changed; you can try again.'
    }
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
          issuer: {
            label: 'Token issuer',
            invalidToken: 'The token is not a JWT with an issuer (iss), so its issuer could not be checked.',
            mismatchExplanation: 'The token issuer differs from the one EthicApp expects for these URLs. With this connection, EthicApp would reject every callback from AI Additions. The expected issuer is the Keycloak public URL (or the AI Additions URL followed by /keycloak) plus /realms/<realm>.',
            expected: 'Expected',
            actual: 'In the token',
            suggestion: 'Keycloak public URL that matches the token:',
            realmMismatch: 'The realm in the token differs from the one EthicApp uses (AI_ADDITIONS_KEYCLOAK_REALM), so no Keycloak public URL fixes this; check the EthicApp deployment.'
          },
          catalog: 'Catalog read',
          success: 'The connection works. AI Additions offers {{count}} services.',
          failure: 'The connection test failed. The URLs were not saved.',
          status: {
            ok: 'OK',
            failed: 'Failed',
            skipped: 'Not attempted'
          }
        },
        confirmSave: {
          title: 'Save the AI Additions connection?',
          body: 'EthicApp will reach AI Additions at {{baseUrl}}.',
          details: 'Running activities follow the new connection.'
        },
        remove: {
          title: 'Remove the AI Additions connection?',
          body: 'This stops every AI call immediately, including in activities that are running now.',
          policyKept: 'The allowed services and their history are kept, and apply again if a connection is saved later.',
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
        adaptersHelp: 'Switch an adapter off to stop that analysis or feature while the rest of the service keeps working.',
        adapterNeedsService: 'Allow the service to switch its adapters on or off.',
        enableAdapter: 'Enable {{name}}',
        scopes: {
          case: 'Case analyses',
          design: 'Design analyses',
          response: 'Responses',
          chat: 'Chat',
          other: 'Other'
        },
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
        confirmSave: {
          title: 'Save a new policy version?',
          allowed: 'The new version allows these services: {{services}}.',
          none: 'The new version allows no services.',
          disabledAdapters: 'These adapters are switched off: {{adapters}}.',
          confirm: 'Save version'
        },
        errors: {
          unknownIds: 'AI Additions does not offer these services: {{ids}}.',
          catalogUnavailable: 'The catalog could not be read to check the selected services.',
          unknownAdapterIds: 'These adapters do not belong to the allowed services, so they cannot be switched off: {{ids}}.'
        }
      },
      history: {
        heading: 'Version history',
        description: 'Every saved policy, newest first. Versions are never edited. Sessions count only launched activities pinned to each version.',
        empty: 'No versions yet.',
        current: 'Current',
        systemAuthor: 'System',
        noServices: 'No services',
        noDisabledAdapters: 'None',
        columns: {
          version: 'Version',
          date: 'Date',
          author: 'Author',
          allowed: 'Allowed services',
          disabledAdapters: 'Switched-off adapters',
          note: 'Note',
          sessions: 'Launched sessions'
        }
      },
      errors: {
        not_configured: 'No AI Additions connection is configured.',
        credentials_missing: 'EthicApp has no AI Additions client credentials, so no request was sent. Set AI_ADDITIONS_KEYCLOAK_CLIENT_ID and AI_ADDITIONS_KEYCLOAK_CLIENT_SECRET in the EthicApp deployment configuration and redeploy it (see "AI Services" in INSTALL.md).',
        unreachable: 'AI Additions could not be reached.',
        unauthorized: 'AI Additions rejected the EthicApp credentials.',
        invalid_response: 'AI Additions answered with an unexpected response.',
        issuer_mismatch: 'The token issuer differs from the expected one.',
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
        createdAt: 'Created',
        actions: 'Actions'
      },
      status: {
        active: 'Active',
        inactive: 'Deactivated',
        pending: 'Pending confirmation'
      },
      actions: {
        view: 'View details'
      },
      createdAtUnknown: 'Unknown',
      sort: {
        newestFirst: 'Sort newest first',
        oldestFirst: 'Sort oldest first'
      },
      empty: 'No users found for the selected filters.',
      pagination: 'Page {{page}} of {{totalPages}} ({{total}} users)',
      accountDeleted: 'The account was deleted. Its email can be used to sign up again.'
    },
    userShow: {
      heading: 'Account details',
      back: 'Back',
      roleHelp: 'Only student/professor role transitions are allowed.',
      saveSuccess: 'User updated successfully.',
      saveError: 'Unable to update user.',
      passwordResetSuccess: 'Password recovery email was sent.',
      passwordResetError: 'Unable to trigger password recovery flow.',
      impersonationError: 'Unable to start professor impersonation.',
      confirmAccountSuccess: 'Account confirmed. {{name}} can now sign in with the password they chose when signing up.',
      confirmAccountError: 'Unable to confirm the account.',
      unsavedChangesHint: {
        template: 'Save or discard your changes before {{actions}} this account.',
        confirm: 'confirming',
        delete: 'deleting',
        forget: 'forgetting',
        or: 'or',
        orBeforeO: 'or'
      },
      errors: {
        accountNotPending: 'This account is not pending confirmation any more, so it was not changed. Its current status is shown below.',
        accountChanged: 'The email of this account changed since the page was loaded, so it was not confirmed. Check the email shown below and try again.',
        userNotFound: 'This account no longer exists.',
        invalidUserId: 'The account identifier is not valid.'
      },
      accountStatus: {
        active: {
          label: 'Active',
          description: 'The email is confirmed and the owner can sign in.'
        },
        pending: {
          label: 'Pending confirmation',
          description: 'The owner signed up but never confirmed their email, so they cannot sign in yet.'
        },
        inactive: {
          label: 'Deactivated by an administrator',
          description: 'The email was confirmed, but an administrator deactivated the account, so the owner cannot sign in.'
        },
        anonymized: {
          label: 'Anonymized',
          description: 'This account was anonymized and no longer identifies anyone.'
        }
      },
      fields: {
        firstname: 'First name',
        lastname: 'Last name',
        gender: 'Gender',
        role: 'Role',
        status: 'Account status',
        createdAt: 'Created',
        lastLogin: 'Last login',
        email: 'Email',
        emailConfirmation: 'Confirm email'
      },
      confirm: {
        save: {
          title: 'Save the changes to this account?',
          body: 'The account of {{name}} will be updated.',
          confirm: 'Save changes'
        },
        passwordReset: {
          title: 'Send a password recovery email?',
          body: 'A password recovery email will be sent to {{email}}.',
          confirm: 'Send email'
        },
        confirmAccount: {
          title: 'Confirm this account?',
          body: 'The email {{email}} will be marked as confirmed and the account activated. {{name}} will be able to sign in with the password they chose when signing up. No email is sent.',
          confirm: 'Confirm account'
        },
        impersonation: {
          title: 'Sign in as this professor?',
          body: 'You will use EthicApp as {{name}} until you go back to the management console.',
          confirm: 'Sign in as professor'
        }
      },
      status: {
        active: 'Active account',
        inactive: 'Inactive account',
        pendingActivationHelp: 'To activate a pending account, use “Confirm account”.',
        createdAtUnknown: 'Unknown (not recorded)',
        neverLoggedIn: 'Never'
      },
      actions: {
        save: 'Save changes',
        cancel: 'Cancel',
        triggerPasswordReset: 'Trigger password recovery',
        confirmAccount: 'Confirm account',
        discardChanges: 'Discard changes',
        impersonateProfessor: 'Sign in as professor'
      },
      deleteAccount: {
        action: 'Delete account',
        title: 'Delete this account?',
        body: 'The account of {{name}} ({{email}}) will be deleted permanently. This cannot be undone. The email can then be used to sign up again.',
        createdAgo: 'The account was created {{age}} ({{date}}) and was never activated.',
        createdUnknown: 'How long the account has been pending is unknown: it was created before creation dates were recorded.',
        confirm: 'Delete account',
        error: 'Unable to delete the account.',
        errors: {
          accountNotDeletable: 'Only accounts that were never activated can be deleted, and this one was activated or used. It was not deleted; its current status is shown below.',
          accountChanged: 'The email of this account changed since the page was loaded, so it was not deleted. Check the email shown below and try again.',
          accountReferenced: 'This account has {{data}} (table {{table}}), so it was not deleted.'
        },
        referenceCategories: {
          activities: 'activity participations',
          teams: 'team memberships',
          responses: 'activity responses or chat messages',
          authoredContent: 'cases or designs it created',
          administration: 'administrative records',
          aiServices: 'AI service jobs or results',
          accountData: 'account data'
        }
      }
    },
    userForget: {
      action: 'Forget this student',
      success: 'EthicApp forgot {{name}}. The account is disabled and anonymized. The AI services are asked to erase their data in the background.',
      error: 'Unable to forget the student.',
      confirm: {
        title: 'Forget this student?',
        body: 'EthicApp will forget {{name}} ({{email}}). This cannot be undone.',
        detailAccount: 'The account is disabled at once: open sessions stop working and the old credentials no longer sign in.',
        detailIdentity: 'The name, email, RUT and profile data are replaced with anonymous values.',
        detailResponses: 'Written responses and chat messages are replaced with a placeholder. Their rows are kept, so group chats stay consistent.',
        detailAiServices: 'The text kept with AI service work in EthicApp is erased, and the Argumentation Tutor and Polyadic Agents are asked to erase what they keep about the student, in the background.',
        confirm: 'Forget student'
      },
      errors: {
        accountAnonymized: 'This account was already anonymized, so it was not changed. Its current status is shown below.',
        notAStudent: 'Only student accounts can be forgotten here, so this account was not changed.',
        accountChanged: 'The email of this account changed since the page was loaded, so it was not forgotten. Check the account shown below and try again.'
      },
      status: {
        heading: 'Data erasure',
        help: 'The AI services erase their data in the background. A service that is unavailable is retried automatically, with growing intervals.',
        ethicapp: 'EthicApp',
        done: '{{service}} ✓',
        pending: '{{service}}: pending',
        retrying: '{{service}}: retrying',
        failed: '{{service}}: failed',
        lastError: 'Last error: {{code}}',
        none: 'No AI service erasure was recorded for this account: it was anonymized before EthicApp asked the AI services to forget students.',
        unavailable: 'The erasure status of the AI services is unavailable right now, because EthicApp could not be reached.',
        retry: 'Retry the erasure',
        retryError: 'Unable to retry the erasure now, because EthicApp could not be reached.',
        services: {
          'argumentation-tutor': 'Tutor',
          'polyadic-agent': 'Polyadic'
        }
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
