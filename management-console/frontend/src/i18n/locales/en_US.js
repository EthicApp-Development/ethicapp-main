export default {
  app: {
    title: 'Management Console',
    subtitle: 'Single-tenant user operations'
  },
  nav: {
    users: 'Users',
    logout: 'Log out'
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
        email: 'Email',
        emailConfirmation: 'Confirm email',
        adminPassword: 'Administrator password'
      },
      status: {
        active: 'Active account',
        inactive: 'Inactive account',
        emailConfirmed: 'Email confirmed',
        emailPending: 'Email confirmation pending'
      },
      actions: {
        save: 'Save changes',
        cancel: 'Cancel',
        triggerPasswordReset: 'Trigger password recovery',
        impersonateProfessor: 'Sign in as professor'
      }
    }
  }
};
