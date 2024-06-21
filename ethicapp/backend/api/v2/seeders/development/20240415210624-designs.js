'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('designs', [
      {
        creator: 1, 
        question_id: 1,
        design: JSON.stringify({ 
          phases: [{
            number: 1,
            question: [{
              text: '¿cuales son los signos de exclamacion?',
              content: { question: '¿selecciones los signos de exclamacion?', options: ['¿?', '¡!', '{}'], correct_answer: '¡!' },
              additional_info: 'signos',
              type: 'choice',
              session_id: 4,
              number: 1
            }]
          },{
            number: 2,
            question: [{
              text: '¿cuales son los signos de preguntas?',
              content: { question: '¿selecciones los signos de preguntas?', options: ['¿?', '¡!', '{}'], correct_answer: '¿?' },
              additional_info: 'signos',
              type: 'choice',
              session_id: 4,
              number: 1
            }]
          }]
        }),
        public: true,
        locked: false,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        creator: 2,
        design: JSON.stringify({ 
          title: 'Design 2', 
          description: 'This is the second design', 
          elements: [{ type: 'circle', color: 'blue', radius: 50, x: 50, y: 50 }] 
        }),
        public: false,
        locked: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        question_id: 1
      },
      {
        creator: 3,
        design: JSON.stringify({ 
          title: 'Design 3', 
          description: 'This is the third design', 
          elements: [{ type: 'triangle', color: 'green', sideLength: 80, x: 30, y: 30 }] 
        }),
        public: true,
        locked: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        question_id: 3
      },
      {
        creator: 1, 
        question_id: 1,
        design: JSON.stringify({ 
          phases: [{
            number: 1,
            question: [{
              text: '¿cuales son los signos de exclamacion?',
              content: { question: '¿selecciones los signos de exclamacion?', options: ['¿?', '¡!', '{}'], correct_answer: '¡!' },
              additional_info: 'signos',
              type: 'choice',
              session_id: 4,
              number: 1
            }]
          },{
            number: 2,
            question: [{
              text: '¿cuales son los signos de preguntas?',
              content: { question: '¿selecciones los signos de preguntas?', options: ['¿?', '¡!', '{}'], correct_answer: '¿?' },
              additional_info: 'signos',
              type: 'choice',
              session_id: 4,
              number: 1
            }]
          }]
        }),
        public: true,
        locked: false,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        creator: 2,
        design: JSON.stringify({ 
          title: 'Design 5', 
          description: 'This is the fifth design', 
          elements: [{ type: 'line', color: 'black', x1: 10, y1: 10, x2: 100, y2: 100 }] 
        }),
        public: true,
        locked: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        question_id: 2
      }
    ], {});
  },
/*      {
        creator: 1, 
        question_id: 1,
        design: JSON.stringify({ 
          phases: [{
            number: 1,
            question: [{
              text: 'TEXTO',
              content: { question: 'QUESTION', options: ['OPTION1', 'OPTION2', 'OPTION3'], correct_answer: 'OPTION1' },
              additional_info: 'MAYUSCULAS',
              type: 'choice',
              session_id: 1,
              number: 1
            }]
          }]
        }),
        public: true,
        locked: false,
        createdAt: new Date(),
        updatedAt: new Date()
       
      },
      {
        creator: 1, 
        question_id: 2,
        design: JSON.stringify({ 
          phases: [{
            number: 1,
            question: [{
              text: '¿Cuál es tu color favorito?',
              content: { question: '¿Cuál es tu color favorito?', options: ['Violeta', 'Negro', 'Azul'], correct_answer: 'Azul' },
              additional_info: 'Colores',
              type: 'choice',
              session_id: 2,
              number: 1
            }]
          }]
        }),
        public: true,
        locked: false,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        creator: 1, 
        question_id: 3,
        design: JSON.stringify({ 
          phases: [{
            number: 1,
            question: [{
              text: '¿cuales son los signos de exclamacion?',
              content: { question: '¿selecciones los signos de exclamacion?', options: ['¿?', '¡!', '{}'], correct_answer: '¡!' },
              additional_info: 'signos',
              type: 'choice',
              session_id: 4,
              number: 1
            }]
          },{
            number: 2,
            question: [{
              text: '¿cuales son los signos de preguntas?',
              content: { question: '¿selecciones los signos de preguntas?', options: ['¿?', '¡!', '{}'], correct_answer: '¿?' },
              additional_info: 'signos',
              type: 'choice',
              session_id: 4,
              number: 1
            }]
          }]
        }),
        public: true,
        locked: false,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        creator: 1, 
        question_id: 2,
        design: JSON.stringify({ 
          phases: [{
            number: 1,
            question: [{
              text: 'letras en español',
              content: { question: '¿Cuál es la unica letra que solo esta en el español?', options: ['H', 'W', 'Ñ'], correct_answer: 'Ñ' },
              additional_info: 'Colores',
              type: 'choice',
              session_id: 5,
              number: 1
            }]
          }]
        }),
        public: true,
        locked: false,
        createdAt: new Date(),
        updatedAt: new Date()
      } */
  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('designs', null, {});
  }
};
