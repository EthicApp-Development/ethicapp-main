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
            user: "profesor1@test",
            pass: "profesor1",
        }, {
            withCredentials: true // Permite manejar cookies
        });
        client.defaults.signal = signal;


        expect.extend({
            toBeTypeOrNull(received, classTypeOrNull) {
                try {
                    expect(received).toEqual(expect.any(classTypeOrNull));
                    return {
                        message: () => `Ok`,
                        pass: true
                      };
                } catch (error) {
                    return received === null 
                      ? {
                            message: () => `Ok`,
                            pass: true
                        }
                      : {
                            message: () => `expected ${received} to be ${classTypeOrNull} type or null`,
                            pass: false
                      };
                }
            }
          });

    });

    afterAll(() => {
        controller.abort();
    });
    
    let caseId;
    let caseClonedId;
    let initalNumberOfCases;
    let finalNumberOfCases;
    let documentId1;
    let documentId2;
    let designId = 34; // Seeded design
    let caseUpdated;

    it("Should get all cases grouped by my_cases and public_cases without rich_text or documents", async () => {
        const response = await client.get(endpoint("cases"));
    
        expect(response.status).toBe(200);
    
        expect(response.data).toMatchObject({
            status: "ok",
            result: {
                my_cases: expect.any(Array),
                public_cases: expect.any(Array),
            },
        });
    
        response.data.result.my_cases.forEach((_case) => {
            expect(_case).toMatchObject({
                case_id: expect.any(Number),
                is_public: expect.any(Boolean),
                user_id: expect.any(Number),
                creator: expect.any(String),
                topic_tags: expect.any(Array),
                created_at: expect.any(String),
                updated_at: expect.any(String),
                locked: expect.any(Boolean),
            });
        
            expect(_case.title).toBeTypeOrNull(String);
            expect(_case.description).toBeTypeOrNull(String);
        
            expect(_case).not.toHaveProperty("rich_text");
            expect(_case).not.toHaveProperty("documents");
        });

        response.data.result.public_cases.forEach((_case) => {
            expect(_case).toMatchObject({
                case_id: expect.any(Number),
                is_public: expect.any(Boolean),
                user_id: expect.any(Number),
                creator: expect.any(String),
                topic_tags: expect.any(Array),
                created_at: expect.any(String),
                updated_at: expect.any(String),
                locked: expect.any(Boolean),
            });
        
            expect(_case.title).toBeTypeOrNull(String);
            expect(_case.description).toBeTypeOrNull(String);
        
            expect(_case).not.toHaveProperty("rich_text");
            expect(_case).not.toHaveProperty("documents");
        });
            
            
        try {
            initalNumberOfCases =
                response.data.result.my_cases.length +
                response.data.result.public_cases.length;
            console.log("Initial number of cases:", initalNumberOfCases);
        } catch (error) {
            console.error("Error calculating the total number of cases:", error);
        }
    });

   
    it("Should create an empty case", async () => {
        const response = await client.post(endpoint("cases"));

        expect(response.status).toBe(201);
        expect(response.data).toEqual({
            status: "success",
            message: "Case created",
            caseId: expect.any(Number)
        });

        try {
            caseId = response.data.caseId;
        }
        catch (error) {
            console.error("Error:", error);
        }
    });

    it("Should get the empty case", async () => {
        const response = await client.get(endpoint(`cases/${caseId}`));
    
        expect(response.status).toBe(200);
        expect(response.data).toMatchObject({
            status: "success",
            result: {
                case_id: caseId,
                title: null,
                description: null,
                rich_text: "",
                is_public: false,
                external_case_url: null,
                user_id: expect.any(Number),
                topic_tags: [],
                documents: [],
                created_at: expect.any(String),
                updated_at: expect.any(String)
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

    it("Should upload PDF files to the case created", async () => {
        const form = new FormData();
        
        form.append('pdf', fs.createReadStream(path.join(__dirname, '../fixtures/static/lorem-ipsum-1.pdf')));
        form.append('pdf', fs.createReadStream(path.join(__dirname, '../fixtures/static/lorem-ipsum-2.pdf')));
    
        const response = await client.post(endpoint(`cases/${caseId}/documents`), form);
    
        expect(response.status).toBe(201);
        expect(response.data).toMatchObject({
            status: 'success',
            result: expect.arrayContaining([
                expect.objectContaining({
                    id: expect.any(Number),
                    name: expect.stringContaining('.pdf'),
                    path: expect.stringContaining('/assets/uploads/')
                })
            ])
        });
    
        try {
            documentId1 = response.data.result[0].id;
            documentId2 = response.data.result[1].id;
        } catch (error) {
            console.error("Error saving document IDs:", error);
        }
    });

    it("Should get the case with attributes edited", async () => {
        const response = await client.get(endpoint(`cases/${caseId}`));

        expect(response.status).toBe(200);
        expect(response.data).toEqual({
            status: "success",
            result: {
                case_id: caseId,
                title: "Test Case",
                description: "This is a test case",
                is_public: true,
                external_case_url: null,
                user_id: 2,
                topic_tags: [],
                created_at: expect.any(String),
                updated_at: expect.any(String),
                rich_text: expect.any(String),
                documents: [
                    {
                        id: expect.any(Number),
                        name: expect.any(String),
                        path: expect.any(String),
                    },
                    {
                        id: expect.any(Number),
                        name: expect.any(String),
                        path: expect.any(String),
                    }
                ]
            }   
        });
    });

    it("Should delete one document attached to the case", async () => {
        const response = await client.delete(endpoint(`cases/${caseId}/documents/${documentId1}`));

        expect(response.status).toBe(204);

    });

    it("Should get the case with one document", async () => {
        const response = await client.get(endpoint(`cases/${caseId}`));

        expect(response.status).toBe(200);
        expect(response.data.result.documents).toEqual([
            {
                id: expect.any(Number),
                name: expect.any(String),
                path: expect.any(String),
            }
        ]);

        try {
            documentId1 = response.data.result.documents[0].id;
            caseUpdated = response.data.result;
        } catch (error) {
            console.error("Error:", error);
        }
    });

    it("Should clone the case created", async () => {
        const response = await client.post(endpoint(`cases/${caseId}/clone`));

        expect(response.status).toBe(200);
        expect(response.data).toEqual({
            status: "success",
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
            result: {
                ...caseUpdated,
                creator: expect.any(String)
            }
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
    
        expect(response.data).toMatchObject({
            status: "ok",
            result: {
                my_cases: expect.any(Array),
                public_cases: expect.any(Array),
            },
        });
    
        response.data.result.my_cases.forEach((_case) => {
            expect(_case).toMatchObject({
                case_id: expect.any(Number),
                is_public: expect.any(Boolean),
                user_id: expect.any(Number),
                creator: expect.any(String),
                topic_tags: expect.any(Array),
                created_at: expect.any(String),
                updated_at: expect.any(String),
                locked: expect.any(Boolean),
            });
        
            expect(_case.title).toBeTypeOrNull(String);
            expect(_case.description).toBeTypeOrNull(String);
        
            expect(_case).not.toHaveProperty("rich_text");
            expect(_case).not.toHaveProperty("documents");
        });

        response.data.result.public_cases.forEach((_case) => {
            expect(_case).toMatchObject({
                case_id: expect.any(Number),
                is_public: expect.any(Boolean),
                user_id: expect.any(Number),
                creator: expect.any(String),
                topic_tags: expect.any(Array),
                created_at: expect.any(String),
                updated_at: expect.any(String),
                locked: expect.any(Boolean),
            });
        
            expect(_case.title).toBeTypeOrNull(String);
            expect(_case.description).toBeTypeOrNull(String);
        
            expect(_case).not.toHaveProperty("rich_text");
            expect(_case).not.toHaveProperty("documents");
        });
            
            
        try {
            finalNumberOfCases =
                response.data.result.my_cases.length +
                response.data.result.public_cases.length;
            console.log("Final number of cases:", initalNumberOfCases);
        } catch (error) {
            console.error("Error calculating the total number of cases:", error);
        }

        expect(finalNumberOfCases).toBe(initalNumberOfCases);
    });
    
});
