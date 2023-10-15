import { LoginController } from "../../controllers/login_controller.js";

let app = angular.module("SessionAccount", ["ngSanitize",
    "pascalprecht.translate"]
);

app.controller("LoginController", LoginController);

