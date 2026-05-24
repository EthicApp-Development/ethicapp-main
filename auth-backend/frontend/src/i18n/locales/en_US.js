const enUS = {
  passwordField: {
    defaultLabel: 'Password',
    visibility: {
      show: 'Show',
      hide: 'Hide'
    }
  },
  login: {
    title: 'Sign in',
    subtitle: 'Access with your credentials',
    noAccount: "Don't have an account?",
    createAccount: 'Create account',
    usernameLabel: 'Username',
    passwordLabel: 'Password',
    forgotPassword: 'Forgot your password?',
    submit: 'Sign in',
    submitting: 'Signing in...',
    continuePolicyPrefix: 'By continuing, you agree to our',
    privacyPolicy: 'Privacy Policy',
    termsOfUse: 'Terms of Use',
    continuePolicyConnector: 'and',
    continuePolicySuffix: '.',
    errors: {
      usernameRequired: 'Username is required.',
      passwordRequired: 'Password is required.',
      genericLoginError: 'We could not sign you in. Check your credentials.'
    },
    notices: {
      accountConfirmed: 'Your account has been confirmed. You can now sign in.',
      confirmationInvalid: 'The confirmation link is invalid or has expired. Use password recovery to request a new link.',
      confirmationError: 'We could not confirm your account. Use password recovery to request a new link.'
    }
  },
  register: {
    pageTitle: 'Create account',
    pageSubtitle: 'Complete your details to sign up',
    fields: {
      firstname: 'First name',
      lastname: 'Last name',
      dni: 'National ID',
      email: 'Email address',
      gender: 'Gender',
      password: 'Password',
      passwordConfirmation: 'Confirm password'
    },
    placeholders: {
      dni: 'No dots, use hyphen',
      gender: 'Select an option'
    },
    genderOptions: {
      female: 'Female',
      male: 'Male',
      other: 'Other'
    },
    passwordRules: {
      helpText: 'Minimum 10 characters and at least 2 symbols.',
      minLength: 'Minimum 10 characters',
      twoSymbols: 'At least 2 symbols'
    },
    submit: 'Create account',
    submitting: 'Creating account...',
    privacyAcceptancePrefix: 'I have read and accept the',
    privacyPolicy: 'Privacy Policy',
    privacyAcceptanceSuffix: '.',
    privacyNoticePartOne: 'Your data will be used to manage your account and platform usage.',
    privacyNoticePartTwo:
      'Data use for research purposes will only occur with your explicit consent in specific studies.',
    privacyNoticePartThreePrefix: 'Read more in our',
    privacyNoticePartThreeSuffix: '.',
    alreadyHaveAccount: 'Already have an account?',
    signInLink: 'Sign in',
    successMessage: 'Account created successfully. Check your email to confirm it before signing in.',
    redirectingToLoginPrefix: 'Redirecting to sign in in ',
    redirectingToLoginSuffix: ' s...',
    recoverPasswordLink: 'Recover password',
    errors: {
      firstnameRequired: 'First name is required.',
      lastnameRequired: 'Last name is required.',
      dniRequired: 'Identifier is required.',
      emailRequired: 'Email is required.',
      emailInvalid: 'Enter a valid email address.',
      genderRequired: 'You must select an option.',
      passwordRequired: 'Password is required.',
      passwordInvalid: 'Password must be at least 10 characters and include 2 symbols.',
      passwordConfirmationRequired: 'You must confirm the password.',
      passwordMismatch: 'Passwords do not match.',
      privacyAcceptanceRequired: 'You must accept the Privacy Policy to create an account.',
      recaptchaRequired: 'You must complete the reCAPTCHA.',
      emailAlreadyRegistered: 'An account with that email already exists.',
      genericRegisterError: 'We could not complete sign up. Please try again.'
    }
  },
  forgotPassword: {
    pageTitle: 'Recover password',
    pageSubtitle: 'We will help you restore access to your account',
    emailLabel: 'Email address',
    instructions: 'Enter your account email and we will send a password reset link.',
    submit: 'Send instructions',
    submitting: 'Sending...',
    backToLogin: 'Back to sign in',
    successMessage: 'If an account exists for that email, you will receive reset instructions. Pending accounts can be activated from that link.',
    errors: {
      emailRequired: 'Email is required.',
      emailInvalid: 'Enter a valid email address.',
      recaptchaRequired: 'You must complete the reCAPTCHA.',
      genericForgotError: 'We could not process your request. Please try again.'
    }
  },
  resetPassword: {
    pageTitle: 'New password',
    pageSubtitle: 'Enter your new password to recover access',
    passwordLabel: 'New password',
    passwordConfirmationLabel: 'Confirm new password',
    submit: 'Update password',
    submitting: 'Updating...',
    backToLogin: 'Back to sign in',
    successMessage: 'Password updated successfully. If your account was pending confirmation, it is now active. You will be redirected to sign in.',
    passwordRules: {
      helpText: 'Minimum 10 characters and at least 2 symbols.',
      minLength: 'Minimum 10 characters',
      twoSymbols: 'At least 2 symbols'
    },
    errors: {
      invalidToken: 'The recovery link is not valid.',
      passwordRequired: 'New password is required.',
      passwordInvalid: 'Password must be at least 10 characters and include 2 symbols.',
      passwordConfirmationRequired: 'You must confirm the password.',
      passwordMismatch: 'Passwords do not match.',
      genericResetError: 'We could not reset the password. Request a new link.'
    }
  },
  notFound: {
    code: '404',
    title: 'Page not found',
    message: 'The requested page does not exist or has been moved.',
    backToLogin: 'Back to sign in'
  },
  legal: {
    back: 'Back',
    privacy: {
      title: 'Privacy Policy',
      updatedAt: 'Last updated: April 15, 2026'
    },
    terms: {
      title: 'Terms of Use',
      updatedAt: 'Last updated: April 16, 2026'
    }
  },
  cookieNotice: {
    title: 'Cookie and session information',
    closeLabel: 'Close notice',
    acceptLabel: 'Understood',
    linksPrefix: 'You can review',
    privacyPolicy: 'the privacy policy',
    linksConnector: 'and',
    termsOfService: 'the terms of service'
  }
};

export default enUS;
