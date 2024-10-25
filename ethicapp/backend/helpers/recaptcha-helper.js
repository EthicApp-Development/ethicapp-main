import axios from "axios";

export let validateRecaptcha = async (responseKey) => {
    try {
        const secretKey = process.env.RECAPTCHA_SECRET;
        const captchaURL = "https://www.google.com/recaptcha/api/siteverify";

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
