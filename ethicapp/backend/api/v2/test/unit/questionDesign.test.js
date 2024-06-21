const request = require('supertest');
const app = require('../../testApi');
const { Session, User, Question } = require('../../models');
const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';

describe('POST /questions/testing', () => {
    let sessionId;
    let professorToken;
    let userId;

    beforeAll(async () => {
        // Crear un usuario profesor
        const user = await User.create({ name: 'ProfessorQuestion',
             rut: "99111222-k",
             mail: 'ProfessorQuestion@example.com', 
             pass: 'passwordQuestion',
             pass_confirmation: "passwordQuestion",
             sex: "M",
             role: 'P' });
        userId = user.id;

        // Autenticar al profesor y obtener un token
        const loginRes = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/authenticate_client`)
            .send({ mail: 'ProfessorQuestion@example.com', pass: 'passwordQuestion' });
        professorToken = loginRes.body.token;

        // Crear una sesión
        await request(app)
        .post(`${API_VERSION_PATH_PREFIX}/designs`)
        .send({
          creator: userId,
          design: {
            phases: [{
              number: 1,
              question: [
                {
                  content: {
                    question: "¿Cuantos oceanos hay actualmente",
                    options: ["5", "7", "10", "11", "1"],
                    correct_answer: "5"
                  },
                  additional_info: "Geografia",
                  type: "choice",
                  text: "preguntas sobre el oceano",
                  session_id: 1,
                  number: 1
                },
                {
                  content: {
                    question: "¿Cuantos continentes hay actualmente",
                    options: ["5", "7", "10", "11", "1"],
                    correct_answer: "5"
                  },
                  additional_info: "Geografia",
                  type: "choice",
                  text: "preguntas sobre los continentes",
                  session_id: 1,
                  number: 2
                }]
            }, {
              number: 2,
              question: [{
                content: {
                  question: "¿asdffasd dsffds sd fsdf",
                  options: ["dsf", "qw", "1wer", "1er1", "1e"],
                  correct_answer: "qw"
                },
                additional_info: "cosas",
                type: "choice",
                text: "preguntas sobre las cosas",
                session_id: 1,
                number: 1
              }]
            }]
          },
          public: true,
          locked: false
        })
  
        const sessionRes = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/sessions`)
            .send({ name: 'Test Session', descr: 'A session for testing', time: new Date(), creator: userId, type: 'A' })
            .set('Authorization', `Bearer ${professorToken}`)
        
            sessionId = sessionRes.body.data.id;
        

    });

    it('should not allow creating duplicate questions in the same phase', async () => {
        //console.log('should not allow creating duplicate questions in the same phase')
        const questionData = {
            text: '¿Cuál es tu pelicula favorito?',
            content: { question: '¿Cuál es tu pelicula favorito?', options: ['dune', 'alien', 'thor'], correct_answer: 'thor' },
            additional_info: 'peliculas',
            type: 'choice',
            session_id: sessionId,
            number: 2
        };
        const designsData = {
            creator: userId,
            design: {
                phases: [{
                    number: 1,
                    question: [{
                        text: '¿Cuál es tu color favorito?',
                        content: { question: '¿Cuál es tu color favorito?', options: ['Violeta', 'Negro', 'Azul'], correct_answer: 'Azul' },
                        additional_info: 'Colores',
                        type: 'choice',
                        session_id: sessionId,
                        number: 2
                            },
                            {
                        text: '¿Cuál es tu pais favorito?',
                        content: { question: '¿Cuál es tu  pais favorito?', options: ['Chile','Ecuador','Japon'], correct_answer: 'Chile' },
                        additional_info: 'paises',
                        type: 'choice',
                        session_id: sessionId,
                        number: 1
                              }]
                        },{
                    number: 2,
                    question: [{
                            text: '¿Cuál es tu animal favorito?',
                            content: { question: '¿Cuál es tu  animal favorito?', options: ['vaca','leon','tigre'], correct_answer: 'vaca' },
                            additional_info: 'animales',
                            type: 'choice',
                            session_id: sessionId,
                            number: 2
                          }]
                        }]
            },
            public: true,
            locked: false
        }
        await request(app)
          .post(`${API_VERSION_PATH_PREFIX}/designs`)
          .send(designsData)
          .expect(201);
        const res = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/designs/${1}/phases/${1}/questions`)
            .send(questionData)
        
        expect(res.status).toBe(400);
        expect(res.body.status).toBe('error');
        expect(res.body.message).toBe('Question already exists for this phase');
    });

    it('should return an error if the design is missing phases', async () => {
        //console.log("should return an error if the design is missing phases")
        const questionData = {
            text: '¿Cuál es tu pelicula favorito?',
            content: { question: '¿Cuál es tu pelicula favorito?', options: ['dune', 'alien', 'thor'], correct_answer: 'thor' },
            additional_info: 'peliculas',
            type: 'choice',
            session_id: 5,
            number: 1
        };
        const designsData = {
            creator: 5,
            question_id: 1,
            design: {},
            public: true,
            locked: false
        }
        await request(app)
          .post(`${API_VERSION_PATH_PREFIX}/designs`)
          .send(designsData)
          .expect(201);
          const res = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/designs/${1}/phases/${1}/questions`)
            .send(questionData)

        expect(res.body.status).toBe('error');
        expect(res.body.message).toBe('Design is missing phases');
    });
});
