export default {
  app: {
    title: 'Management Console',
    subtitle: 'Single-tenant user operations'
  },
  nav: {
    users: 'Users'
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
        actions: 'Actions'
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
        email: 'Email',
        emailConfirmation: 'Confirm email',
        adminPassword: 'Administrator password'
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
