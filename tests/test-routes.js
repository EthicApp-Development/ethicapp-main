"use strict";

let request = require('supertest');
let app = require('../app');

describe("Routes", () => {
    it("Main page redirects to login", (done) => {
        request(app)
            .get("/")
            .expect(302)
            .expect("Location", "login", done);
    });
});