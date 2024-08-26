const axios = require("axios");
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');


const controller = new AbortController();
const signal = controller.signal;

const BASE_URL = "http://localhost:5050/";
const endpoint = (path) => `${BASE_URL}${path}`;


describe("API Tests with Axios for Cases", () => {

    beforeAll(async () => {
        // const loginResponse = await axios.post(endpoint("login"), {
        //     user: "profesor@test",
        //     pass: "profesor",
        // }, {
        //     withCredentials: true // Permite manejar cookies
        // });
        axios.defaults.signal = signal;

    });

    afterAll( () => {
        controller.abort();
    });
    
    let caseId;
    let actualNumberOfCases;
    let documentId1;

    it("should get all cases and verify the response", async () => {
        const response = await axios.get(endpoint("cases"));

        expect(response.status).toBe(200);
        expect(response.data).toEqual({
            status: "ok",
            
            result: expect.any(Array)
        }); 

        try {
            actualNumberOfCases = response.data.result.length;
        }
        catch (error) {
            console.error("Error:", error);
        }
    });

    it("should create an empty case", async () => {
        const response = await axios.post(endpoint("cases"));

        expect(response.status).toBe(201); // Verifica que el código de estado sea 200
        expect(response.data).toEqual({
            status: "success",
            message: "Case created",
            caseId: expect.any(Number)
        }); // Verifica que la respuesta tenga el formato esperado

        try {
            caseId = response.data.caseId;
        }
        catch (error) {
            console.error("Error:", error);
        }
    });

    it("should get the empty case", async () => {
        const response = await axios.get(endpoint(`cases/${caseId}`));

        expect(response.status).toBe(200); // Verifica que el código de estado sea 200
        expect(response.data).toEqual({
            status: "success",
            data: {
                case_id: caseId,
                title: null,
                description: null,
                is_public: false,
                external_case_url: null,
                user_id: null,
                topic_tags: [],
                documents: []
            }   
        }); 
    });

    it("should edit the empty case created before", async () => {
        const response = await axios.patch(endpoint(`cases/${caseId}`), {
            title: "Test Case",
            description: "This is a test case",
            is_public: true,
            user_id: 2, // profesor1 id when seeding
        });

        expect(response.status).toBe(200); 
        expect(response.data).toEqual({
            status: "success",
            message: "Case updated",
        }); 

    });

    it("should upload a PDF file to the case created before", async () => {
        const form = new FormData();
        
        form.append('pdf', fs.createReadStream(path.join(__dirname, 'lorem-ipsum-1.pdf'))); 
        form.append('pdf', fs.createReadStream(path.join(__dirname, 'lorem-ipsum-2.pdf')));

        const response = await axios.post(endpoint(`cases/${caseId}/documents`), form);

        // Verifica la respuesta
        expect(response.status).toBe(201);
        expect(response.data).toHaveProperty('status', 'success');
        expect(response.data).toHaveProperty('message', 'Document uploaded');
    });

    it("should get the case with attributes edited", async () => {
        const response = await axios.get(endpoint(`cases/${caseId}`));

        expect(response.status).toBe(200);
        expect(response.data).toEqual({
            status: "success",
            data: {
                case_id: caseId,
                title: "Test Case",
                description: "This is a test case",
                is_public: true,
                external_case_url: null,
                user_id: 2,
                topic_tags: [],
                documents: [
                    {
                        id: expect.any(Number),
                        path: expect.any(String),
                    },
                    {
                        id: expect.any(Number),
                        path: expect.any(String),
                    }
                ]
            }   
        });

        try {
            documentId1 = response.data.data.documents[0].id;
        } catch (error) {
            console.error("Error:", error);
        }
    });

    it("should delete one document attached to the case", async () => {
        const response = await axios.delete(endpoint(`cases/${caseId}/documents/${documentId1}`));

        expect(response.status).toBe(204);

    });

    it("should get the case with one document", async () => {
        const response = await axios.get(endpoint(`cases/${caseId}`));

        expect(response.status).toBe(200);
        expect(response.data.data.documents).toEqual([
            {
                id: expect.any(Number),
                path: expect.any(String),
            }
        ]);

        try {
            documentId1 = response.data.data.documents[0].id;
        } catch (error) {
            console.error("Error:", error);
        }
    });


    it("should delete the case created before", async () => {
        const response = await axios.delete(endpoint(`cases/${caseId}`));

        expect(response.status).toBe(204);
    });


    it("should not get the case", async () => {
        try {
            await axios.get(endpoint(`cases/${caseId}`));
            fail("The request should not have succeeded");
        } catch (error) {
            expect(error.response.status).toBe(404); 
        }
    });
    


});
