let validateRecaptcha = () => {
    try {
        let response = grecaptcha.getResponse();
        if (response.length === 0) {
            return false;
        } else {
            self.recaptchaError = "";
            return true;
        }    
    } catch (error) {
        return false;
    }
};

export let getRecaptchaResponse = () => {
    try {
        let valid = validateRecaptcha();
        if (!valid) {
            throw new Error("Could not validate recaptcha.");
        }
        let response = grecaptcha.getResponse();
        return response;
    } catch (error) {
        console.error(error);
        return null;
    }
};