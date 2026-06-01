export default {
  app: {
    title: 'Management Console',
    subtitle: 'Single-tenant user operations'
  },
  nav: {
    users: 'Users',
    institution: 'Institution',
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
        academic: 'Academic contact'
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
