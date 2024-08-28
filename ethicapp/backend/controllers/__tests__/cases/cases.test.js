const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

const jar = new CookieJar();
const client = wrapper(axios.create({ jar }));

const FormData = require('form-data');
const fs = require('fs');
const path = require('path');


const controller = new AbortController();
const signal = controller.signal;

const BASE_URL = "http://localhost:5050/";
const endpoint = (path) => `${BASE_URL}${path}`;


describe("API Tests with Axios for Cases", () => {

    beforeAll(async () => {
        const loginResponse = await client.post(endpoint("login"), {
            user: "profesor@test",
            pass: "profesor",
        }, {
            withCredentials: true // Permite manejar cookies
        });
        client.defaults.signal = signal;

    });

    afterAll( () => {
        controller.abort();
    });
    
    let caseId;
    let caseClonedId;
    let initalNumberOfCases;
    let finalNumberOfCases;
    let documentId1;
    let designId = 1; // Seeded design
    let caseUpdated;

    it("Should get all cases n1", async () => {
        const response = await client.get(endpoint("cases"));

        expect(response.status).toBe(200);
        expect(response.data).toEqual({
            status: "ok",
            result: expect.any(Array)
        }); 

        try {
            initalNumberOfCases = response.data.result.length;
        }
        catch (error) {
            console.error("Error:", error);
        }
    });

    it("Should create an empty case", async () => {
        const response = await client.post(endpoint("cases"));

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

    it("Should get the empty case", async () => {
        const response = await client.get(endpoint(`cases/${caseId}`));

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

    it("Should edit the empty case created", async () => {
        const response = await client.patch(endpoint(`cases/${caseId}`), {
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

    it("Should upload a PDF file to the case created", async () => {
        const form = new FormData();
        
        form.append('pdf', fs.createReadStream(path.join(__dirname, '../fixtures/static/lorem-ipsum-1.pdf')));
form.append('pdf', fs.createReadStream(path.join(__dirname, '../fixtures/static/lorem-ipsum-2.pdf')));

        const response = await client.post(endpoint(`cases/${caseId}/documents`), form);

        expect(response.status).toBe(201);
        expect(response.data).toHaveProperty('status', 'success');
        expect(response.data).toHaveProperty('message', 'Document uploaded');
    });

    it("Should get the case with attributes edited", async () => {
        const response = await client.get(endpoint(`cases/${caseId}`));

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

    it("Should delete one document attached to the case", async () => {
        const response = await client.delete(endpoint(`cases/${caseId}/documents/${documentId1}`));

        expect(response.status).toBe(204);

    });

    it("Should get the case with one document", async () => {
        const response = await client.get(endpoint(`cases/${caseId}`));

        expect(response.status).toBe(200);
        expect(response.data.data.documents).toEqual([
            {
                id: expect.any(Number),
                path: expect.any(String),
            }
        ]);

        try {
            documentId1 = response.data.data.documents[0].id;
            caseUpdated = response.data.data;
        } catch (error) {
            console.error("Error:", error);
        }
    });

    it("Should clone the case created", async () => {
        const response = await client.post(endpoint(`cases/${caseId}/clone`));

        expect(response.status).toBe(201);
        expect(response.data).toEqual({
            status: "success",
            message: "Case cloned",
            newCaseId: expect.any(Number)
        });

        try {
            caseClonedId = response.data.newCaseId;
        } catch (error) {
            console.error("Error:", error);
        }
    });


    it("Should get design seeded", async () => {
        const response = await client.get(endpoint(`designs/${designId}`)); // Seeded design

        expect(response.status).toBe(200);
    });


    it("Should associate case to design", async () => {
        const response = await client.patch(endpoint(`designs/${designId}/case`), {
            caseId: caseId
        });

        expect(response.status).toBe(200);
        expect(response.data).toEqual({
            status: "success",
            message: "Design updated",
        });
    });


    it("Should get the case from design", async () => {
        const response = await client.get(endpoint(`designs/${designId}/case`));

        expect(response.status).toBe(200);
        expect(response.data).toEqual({
            status: "success",
            data: caseUpdated
        });
    });


    it("Should delete the case created", async () => {
        const response = await client.delete(endpoint(`cases/${caseId}`));

        expect(response.status).toBe(204);
    });

    it("Should delete the case cloned", async () => {
        const response = await client.delete(endpoint(`cases/${caseClonedId}`));

        expect(response.status).toBe(204);
    });

    it("Should not get the case created", async () => {
        try {
            await client.get(endpoint(`cases/${caseId}`));
            fail("The request Should not have succeeded");
        } catch (error) {
            expect(error.response.status).toBe(404); 
        }
    });

    it("Should not get the case cloned", async () => {
        try {
            await client.get(endpoint(`cases/${caseClonedId}`));
            fail("The request Should not have succeeded");
        } catch (error) {
            expect(error.response.status).toBe(404); 
        }
    });

    it("Should get all cases n2", async () => {
        const response = await client.get(endpoint("cases"));

        expect(response.status).toBe(200);
        expect(response.data).toEqual({
            status: "ok",   
            result: expect.any(Array)
        }); 

        try {
            finalNumberOfCases = response.data.result.length;
        }
        catch (error) {
            console.error("Error:", error);
        }

        expect(finalNumberOfCases).toBe(initalNumberOfCases);
    });
    
});
