import * as Yup from "yup";

export const registerSchema = Yup.object().shape({
    name:                 Yup.string().required("requiredName"),
    lastname:             Yup.string().required("requiredLastName"),
    email:                Yup.string().email("invalidEmail").required("requiredEmail"),
    pass:                 Yup.string().min(8, "minLengthPassword").required("requiredPassword"),
    sex:                  Yup.string().oneOf(["M", "F", "O"], "invalidSex").required("requiredSex"),
    g_recaptcha_response: Yup.string().required("requiredCaptcha")
});

export const teacherAccountRequestSchema = Yup.object().shape({
    name:                 Yup.string().required("requiredName"),
    lastname:             Yup.string().required("requiredLastName"),
    rut:                  Yup.string().optional(),
    email:                Yup.string().email("invalidEmail").required("requiredEmail"),
    pass:                 Yup.string().min(8, "minLengthPassword").required("requiredPassword"),
    sex:                  Yup.string().oneOf(["M", "F", "O"], "invalidSex").required("requiredSex"),
    institution:          Yup.string().required("requiredInstitution"),
    g_recaptcha_response: Yup.string().required("requiredCaptcha")
});

export const passwordRecoveryPageSchema = Yup.object().shape({
    token: Yup.string().required("requiredToken")
});

export const passwordRecoverySchema = Yup.object().shape({
    email:                Yup.string().email("invalidEmail").required("requiredEmail"),
    g_recaptcha_response: Yup.string().required("requiredCaptcha")
});

export const passwordResetSchema = Yup.object().shape({
    email:                Yup.string().email("invalidEmail").required("requiredEmail"),
    pass:                 Yup.string().min(8, "minLengthPassword").required("requiredPassword"),
    cpass:                Yup.string().min(8, "minLengthPassword").required("requiredPassword"),
    token:                Yup.string().min(32, "minTokenLength").required("requiredToken"),
    g_recaptcha_response: Yup.string().required("requiredCaptcha")
});