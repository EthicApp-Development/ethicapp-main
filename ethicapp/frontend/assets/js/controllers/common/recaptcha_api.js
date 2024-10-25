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
        if (!validateRecaptcha()) {
            throw new Error("Could not validate recaptcha.");
        }
        return grecaptcha.getResponse();
    } catch (error) {
        console.error(error);
        return null;
    }
};