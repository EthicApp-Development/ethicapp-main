import axios from "axios";

const isRecaptchaEnabled = () => {
    const rawValue = String(process.env.RECAPTCHA_ENABLED ?? "false").toLowerCase();
    return rawValue === "true" || rawValue === "1";
};

export let validateRecaptcha = async (responseKey) => {
    if (!isRecaptchaEnabled()) {
        return true;
    }

    try {
        const secretKey = process.env.RECAPTCHA_SECRET_KEY;
        const captchaURL = "https://www.google.com/recaptcha/api/siteverify";

        if (!secretKey || !responseKey) {
            throw new Error("Missing reCAPTCHA secret key or token.");
        }

        const response = await axios.post(captchaURL, null, {
            params: {
                secret:   secretKey,
                response: responseKey
            }
        });

        const captchaData = response.data;

        if (!captchaData.success) {
            throw new Error("Unsuccessful request to reCAPTCHA validation site.");
        }

        return true;
    } catch (err) {
        console.error("Captcha validation failed:", err.message);
        return false;
    }
};

export { isRecaptchaEnabled };
