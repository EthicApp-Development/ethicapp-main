export let RegisterController = ($scope, $http, $translate,apiParams) => {
    var self = $scope;
    const lang = navigator.language;
    self.reCaptchaSiteKey = apiParams.reCaptchaSiteKey;

    //Registro Usuario Normal
    self.name = "";
    self.lastname = "";
    self.email = "";
    self.pass = "";
    self.confPass = "";
    self.sex = "";

    //Mensajes de Error
    self.errorMessagesES = {
        nameRequired: "El campo nombre es obligatorio.",
        lastnameRequired: "El campo apellido es obligatorio.",
        emailRequired: "El campo correo electrónico es obligatorio.",
        passwordRequired: "El campo contraseña es obligatorio.",
        passwordsMismatch: "Las contraseñas no coinciden.",
        genderRequired: "Por favor, selecciona tu género.",
        recaptchaRequired: "Por favor, completa el recaptcha."
    };

    self.errorMessagesEN = {
        nameRequired: "The name field is required.",
        lastnameRequired: "The last name field is required.",
        emailRequired: "The email field is required.",
        passwordRequired: "The password field is required.",
        passwordsMismatch: "Passwords do not match.",
        genderRequired: "Please select your gender.",
        recaptchaRequired: "Please complete the reCaptcha."
    };

    self.validateRecaptcha = function() {
        var response = grecaptcha.getResponse(); 
        if (response.length === 0) {
            return false; 
        } else {
            self.recaptchaError = "";
            return true; 
        }
    };

    self.registerUser = function () {
        self.nameError = "";
        self.lastnameError = "";
        self.emailError = "";
        self.passwordError = "";
        self.confirmPasswordError = "";
        self.genderError = "";
        self.recaptchaError = "";

        var errorMessages; 

        if (self.lang === 'EN_US/english') {
            errorMessages = self.errorMessagesEN;
        } else {
            errorMessages = self.errorMessagesES;
        }

        if (!self.name) {
            self.nameError = errorMessages.nameRequired;
        }

        if (!self.lastname) {
            self.lastnameError = errorMessages.lastnameRequired;
        }

        if (!self.email) {
            self.emailError = errorMessages.emailRequired;
        }

        if (!self.pass) {
            self.passwordError = errorMessages.passwordRequired;
        }

        if (self.pass !== self.confPass) {
            self.confirmPasswordError = errorMessages.passwordsMismatch;
        }

        if (!self.sex) {
            self.genderError = errorMessages.genderRequired;
        }

        if (!self.validateRecaptcha()) {
            self.recaptchaError = errorMessages.recaptchaRequired;
        }

        if (self.nameError || self.lastnameError || self.emailError || 
            self.passwordError || self.confirmPasswordError || self.genderError ||
            self.recaptchaError) {
            return;
        }

        //Si no hay errores de validación, llamar a API 
        var userData = {
            name:                   self.name,
            lastname:               self.lastname,
            email:                  self.email,
            pass:                   self.pass,
            sex:                    self.sex,
            g_recaptcha_response: grecaptcha.getResponse() 
        };

        console.log(userData);

        $http.post("/register", userData)
            .then(function (response) {
                console.log(response);
                if (response.data.success) {
                    console.log("Registro exitoso");
                } else {
                    console.error("Error en el registro: ");
                }
            })
            .catch(function (error) {
                console.error("Error en la solicitud al backend: " + error);
            });
    };

    if (lang.startsWith('es')) {
        self.lang = 'ES_CL/spanish';
    } else {
        self.lang = 'EN_US/english';
    }

    self.updateLang = function (langKey) {
        $translate.use(langKey);
    };

    self.changeLang = function () {
        self.lang = self.lang == "EN_US/english" ? "ES_CL/spanish" : "EN_US/english";
        self.updateLang(self.lang);
    };

    self.init = function () {
        self.updateLang(self.lang);
        self.getcountries();
    };

    self.getcountries = function(){
        $http.get("https://restcountries.com/v3.1/all").success(function (data) {
            var list = [];
 
            for(var i = 0;i< data.length;i++){ 
                list.push(data[i].name.common);
            }
            list.sort();
            if(self.lang == "ES_CL/spanish"){
                list.unshift("Elige un Pais");
            }
            else{
                list.unshift("Choose Country");
            }

            self.countries = list;

        });
    };

    self.init();
};
